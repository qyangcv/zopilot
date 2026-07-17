import type {
  AgentStreamEvent,
  RunningTurnContentBlock,
  RunningTurnLifecycle,
  RunningTurnNoticeBlock,
  RunningTurnProjection,
  RunningTurnReasoningBlock,
  RunningTurnSnapshot,
  RunningTurnToolBlock,
  RunningTurnTraceBlock,
} from "../../../domain/agent/streaming";
import type {
  AgentContentPhase,
  AgentReasoningKind,
  AgentTraceItem,
} from "../../../domain/agent/trace";
import type { ProviderBrand } from "../../../domain/agent/providerBrand";
import type { Conversation } from "../../../domain/conversation";
import type { AgentRunResult } from "../../../domain/agent/types";

type RunningTurnOrderEntry =
  | { type: "content"; id: string }
  | { type: "trace"; id: string };

type RunningTurnRecord = {
  answerBlockCache?: readonly RunningTurnContentBlock[];
  answerBlockCacheVersion: number;
  backendId?: string;
  candidateContentIds: Set<string>;
  commentaryViews: Map<string, RunningTurnTraceBlock>;
  contentBlocks: Map<string, RunningTurnContentBlock>;
  contentOrder: string[];
  conversation: Conversation;
  desyncedAppendKeys: Set<string>;
  lastSequence: number;
  legacy?: AgentRunResult["legacy"];
  lifecycle: RunningTurnLifecycle;
  messageId: string;
  model?: string;
  providerBrand?: ProviderBrand;
  providerProfileId?: string;
  reasoningEffort?: string;
  runId?: string;
  stateVersion: number;
  streamOrder: RunningTurnOrderEntry[];
  traceBlockCache?: readonly RunningTurnTraceBlock[];
  traceBlockCacheVersion: number;
  traceBlocks: Map<string, RunningTurnTraceBlock>;
  traceOrder: string[];
  turnId?: string;
  visible: boolean;
};

type RunningTurnCreateInput = {
  conversation: Conversation;
  messageId: string;
  model?: string;
  providerBrand?: ProviderBrand;
  providerProfileId?: string;
  reasoningEffort?: string;
};

type RunningTurnApplyResult = {
  accepted: boolean;
  becameVisible: boolean;
  changed: boolean;
  immediate: boolean;
};

class RunningTurnStore {
  private readonly turns = new Map<string, RunningTurnRecord>();

  create(input: RunningTurnCreateInput): RunningTurnRecord {
    const record: RunningTurnRecord = {
      answerBlockCacheVersion: -1,
      candidateContentIds: new Set(),
      commentaryViews: new Map(),
      contentBlocks: new Map(),
      contentOrder: [],
      conversation: input.conversation,
      desyncedAppendKeys: new Set(),
      lastSequence: 0,
      lifecycle: "running",
      messageId: input.messageId,
      model: input.model,
      providerBrand: input.providerBrand,
      providerProfileId: input.providerProfileId,
      reasoningEffort: input.reasoningEffort,
      stateVersion: 0,
      streamOrder: [],
      traceBlockCacheVersion: -1,
      traceBlocks: new Map(),
      traceOrder: [],
      visible: false,
    };
    this.turns.set(input.conversation.metadata.id, record);
    return record;
  }

  get(conversationId: string): RunningTurnRecord | undefined {
    return this.turns.get(conversationId);
  }

  has(conversationId: string | undefined): boolean {
    return Boolean(conversationId && this.turns.has(conversationId));
  }

  remove(conversationId: string): void {
    this.turns.delete(conversationId);
  }

  apply(
    conversationId: string,
    event: AgentStreamEvent,
    occurredAt = Date.now(),
  ): RunningTurnApplyResult {
    const turn = this.turns.get(conversationId);
    if (!turn || event.sequence <= turn.lastSequence) {
      return unchangedResult();
    }
    if (
      turn.lifecycle === "interrupted" ||
      turn.lifecycle === "failed" ||
      turn.lifecycle === "completed"
    ) {
      return unchangedResult();
    }
    if (
      turn.lifecycle === "interrupting" &&
      !isTerminalTurnEvent(event) &&
      event.type !== "turn.started"
    ) {
      turn.lastSequence = event.sequence;
      return unchangedResult();
    }

    const sequenceGap = event.sequence !== turn.lastSequence + 1;
    turn.lastSequence = event.sequence;
    if (
      isAppendEvent(event) &&
      (sequenceGap || turn.desyncedAppendKeys.has(getAppendKey(event)))
    ) {
      turn.desyncedAppendKeys.add(getAppendKey(event));
      return { ...unchangedResult(), accepted: false };
    }

    const wasVisible = turn.visible;
    let changed = false;

    switch (event.type) {
      case "turn.started":
        changed = updateRunIdentity(turn, event);
        break;
      case "turn.interruptRequested":
        changed = updateLifecycle(turn, "interrupting");
        break;
      case "turn.completed":
        {
          const interrupting = turn.lifecycle === "interrupting";
          changed = this.completeTurn(
            turn,
            interrupting ? "" : event.text,
            interrupting ? "interrupted" : "completed",
            occurredAt,
            !interrupting,
          );
        }
        break;
      case "turn.interrupted":
        changed = this.completeTurn(
          turn,
          turn.lifecycle === "interrupting" ? "" : event.text,
          "interrupted",
          occurredAt,
          turn.lifecycle !== "interrupting",
        );
        break;
      case "turn.failed":
        changed =
          turn.lifecycle === "interrupting"
            ? this.completeTurn(turn, "", "interrupted", occurredAt, false)
            : this.failTurn(turn, event.error, occurredAt);
        break;
      case "content.append":
        changed = this.appendContent(turn, event);
        break;
      case "content.replace":
        changed = this.replaceContent(
          turn,
          event.blockId,
          event.phase,
          event.text,
        );
        break;
      case "content.phase":
        changed = this.updateContentPhase(turn, event.blockId, event.phase);
        break;
      case "reasoning.append":
        changed = this.appendReasoning(turn, event);
        break;
      case "reasoning.replace":
        changed = this.replaceReasoning(
          turn,
          event.blockId,
          event.kind,
          event.text,
        );
        break;
      case "tool.started":
        changed = this.startTool(turn, event, occurredAt);
        break;
      case "tool.arguments.append":
        changed = this.appendToolField(
          turn,
          event.blockId,
          "arguments",
          event.expectedOffset,
          event.delta,
        );
        break;
      case "tool.progress.append":
        changed = this.appendToolField(
          turn,
          event.blockId,
          "progress",
          event.expectedOffset,
          event.delta,
        );
        break;
      case "tool.completed":
        changed = this.completeTool(turn, event, occurredAt);
        break;
      case "notice.upsert":
        changed = this.upsertNotice(turn, event.blockId, event.text);
        break;
    }

    if (changed) {
      turn.stateVersion += 1;
      this.invalidateCaches(turn);
    }
    return {
      accepted: true,
      becameVisible: !wasVisible && turn.visible,
      changed,
      immediate: isImmediateEvent(event),
    };
  }

  requestInterrupt(conversationId: string): RunningTurnApplyResult {
    const turn = this.turns.get(conversationId);
    if (!turn || turn.lifecycle !== "running") return unchangedResult();
    turn.lifecycle = "interrupting";
    turn.stateVersion += 1;
    this.invalidateCaches(turn);
    return {
      accepted: true,
      becameVisible: false,
      changed: true,
      immediate: true,
    };
  }

  reconcileAgentResult(
    conversationId: string,
    result: AgentRunResult,
    occurredAt = Date.now(),
  ): RunningTurnApplyResult {
    const turn = this.turns.get(conversationId);
    if (!turn) return unchangedResult();
    let changed = updateRunIdentity(turn, {
      type: "turn.started",
      sequence: turn.lastSequence,
      backendId: result.backendId,
      providerProfileId: result.providerProfileId,
      runId: result.runId,
      turnId: result.turnId,
      legacy: result.legacy,
    });
    const interrupted =
      result.status === "interrupted" ||
      turn.lifecycle === "interrupting" ||
      turn.lifecycle === "interrupted";
    changed =
      this.completeTurn(
        turn,
        result.text,
        interrupted ? "interrupted" : "completed",
        occurredAt,
        !interrupted,
      ) || changed;
    if (changed) {
      turn.stateVersion += 1;
      this.invalidateCaches(turn);
    }
    return {
      accepted: true,
      becameVisible: false,
      changed,
      immediate: true,
    };
  }

  getSnapshot(conversationId: string): RunningTurnSnapshot | undefined {
    const turn = this.turns.get(conversationId);
    if (!turn) return undefined;
    const answerBlocks = this.getAnswerBlocks(turn);
    const traceBlocks = this.getTraceBlocks(turn);
    return {
      conversationId,
      messageId: turn.messageId,
      lifecycle: turn.lifecycle,
      stateVersion: turn.stateVersion,
      sequence: turn.lastSequence,
      model: turn.model,
      providerProfileId: turn.providerProfileId,
      providerBrand: turn.providerBrand,
      finalStarted: answerBlocks.some((block) => Boolean(block.text)),
      answerBlocks,
      traceBlocks,
      hasRunningTools: traceBlocks.some(
        (block) => block.type === "tool" && block.status === "running",
      ),
    };
  }

  getProjection(conversationId: string): RunningTurnProjection {
    const turn = this.turns.get(conversationId);
    if (!turn) return { finalText: "", trace: [] };
    const finalText = this.getAnswerBlocks(turn)
      .map((block) => block.text)
      .filter(Boolean)
      .join("\n\n");
    const trace = this.getTraceBlocks(turn).map(stripTraceRevision);
    return { finalText, trace };
  }

  getRunIdentity(conversationId: string): {
    backendId?: string;
    providerProfileId?: string;
    runId?: string;
    turnId?: string;
    legacy?: AgentRunResult["legacy"];
  } {
    const turn = this.turns.get(conversationId);
    return {
      backendId: turn?.backendId,
      providerProfileId: turn?.providerProfileId,
      runId: turn?.runId,
      turnId: turn?.turnId,
      legacy: turn?.legacy,
    };
  }

  getLifecycle(conversationId: string): RunningTurnLifecycle | undefined {
    return this.turns.get(conversationId)?.lifecycle;
  }

  private appendContent(
    turn: RunningTurnRecord,
    event: Extract<AgentStreamEvent, { type: "content.append" }>,
  ): boolean {
    const current = turn.contentBlocks.get(event.blockId);
    if ((current?.text.length || 0) !== event.expectedOffset) {
      turn.desyncedAppendKeys.add(getAppendKey(event));
      return false;
    }
    return this.replaceContent(
      turn,
      event.blockId,
      event.phase,
      `${current?.text || ""}${event.delta}`,
    );
  }

  private replaceContent(
    turn: RunningTurnRecord,
    blockId: string,
    phase: AgentContentPhase,
    text: string,
  ): boolean {
    const current = turn.contentBlocks.get(blockId);
    if (current?.text === text && current.phase === phase) return false;
    const next: RunningTurnContentBlock = {
      id: blockId,
      type: "content",
      phase,
      text,
      revision: (current?.revision || 0) + 1,
    };
    if (!current) {
      turn.contentOrder.push(blockId);
      turn.streamOrder.push({ type: "content", id: blockId });
    }
    turn.contentBlocks.set(blockId, next);
    turn.desyncedAppendKeys.delete(`content:${blockId}`);
    updateCandidateMembership(turn, blockId, phase);
    turn.visible ||= Boolean(text);
    return true;
  }

  private updateContentPhase(
    turn: RunningTurnRecord,
    blockId: string,
    phase: AgentContentPhase,
  ): boolean {
    const current = turn.contentBlocks.get(blockId);
    if (!current || current.phase === phase) return false;
    turn.contentBlocks.set(blockId, {
      ...current,
      phase,
      revision: current.revision + 1,
    });
    updateCandidateMembership(turn, blockId, phase);
    return true;
  }

  private appendReasoning(
    turn: RunningTurnRecord,
    event: Extract<AgentStreamEvent, { type: "reasoning.append" }>,
  ): boolean {
    const current = turn.traceBlocks.get(event.blockId);
    const currentText =
      current?.type === "reasoning" ? current.text : undefined;
    if ((currentText?.length || 0) !== event.expectedOffset) {
      turn.desyncedAppendKeys.add(getAppendKey(event));
      return false;
    }
    return this.replaceReasoning(
      turn,
      event.blockId,
      event.kind,
      `${currentText || ""}${event.delta}`,
    );
  }

  private replaceReasoning(
    turn: RunningTurnRecord,
    blockId: string,
    kind: AgentReasoningKind,
    text: string,
  ): boolean {
    const current = turn.traceBlocks.get(blockId);
    if (
      current?.type === "reasoning" &&
      current.text === text &&
      current.kind === kind
    ) {
      return false;
    }
    const next: RunningTurnReasoningBlock = {
      id: blockId,
      type: "reasoning",
      kind,
      text,
      revision: (current?.revision || 0) + 1,
    };
    this.setTraceBlock(turn, blockId, next);
    turn.desyncedAppendKeys.delete(`reasoning:${blockId}`);
    turn.visible ||= Boolean(text);
    return true;
  }

  private startTool(
    turn: RunningTurnRecord,
    event: Extract<AgentStreamEvent, { type: "tool.started" }>,
    occurredAt: number,
  ): boolean {
    this.demoteCandidates(turn);
    const current = turn.traceBlocks.get(event.blockId);
    const tool = current?.type === "tool" ? current : undefined;
    const next: RunningTurnToolBlock = {
      id: event.blockId,
      type: "tool",
      name: event.name,
      server: event.server,
      arguments: event.arguments ?? tool?.arguments,
      progress: tool?.progress,
      result: tool?.result,
      error: tool?.error,
      status: "running",
      startedAt: tool?.startedAt ?? occurredAt,
      durationMs: undefined,
      revision: (tool?.revision || 0) + 1,
    };
    this.setTraceBlock(turn, event.blockId, next);
    if (event.arguments !== undefined) {
      turn.desyncedAppendKeys.delete(`arguments:${event.blockId}`);
    }
    turn.visible = true;
    return true;
  }

  private appendToolField(
    turn: RunningTurnRecord,
    blockId: string,
    field: "arguments" | "progress",
    expectedOffset: number,
    delta: string,
  ): boolean {
    const current = turn.traceBlocks.get(blockId);
    if (current?.type !== "tool") return false;
    const value = current[field] || "";
    const appendKey = `${field}:${blockId}`;
    if (value.length !== expectedOffset) {
      turn.desyncedAppendKeys.add(appendKey);
      return false;
    }
    turn.traceBlocks.set(blockId, {
      ...current,
      [field]: `${value}${delta}`,
      revision: current.revision + 1,
    });
    turn.desyncedAppendKeys.delete(appendKey);
    return true;
  }

  private completeTool(
    turn: RunningTurnRecord,
    event: Extract<AgentStreamEvent, { type: "tool.completed" }>,
    occurredAt: number,
  ): boolean {
    this.demoteCandidates(turn);
    const current = turn.traceBlocks.get(event.blockId);
    const tool = current?.type === "tool" ? current : undefined;
    const next: RunningTurnToolBlock = {
      id: event.blockId,
      type: "tool",
      name: event.name || tool?.name || "tool",
      server: event.server ?? tool?.server,
      arguments: event.arguments ?? tool?.arguments,
      progress: tool?.progress,
      result: event.result,
      error: event.error,
      status: event.error ? "failed" : "completed",
      startedAt: tool?.startedAt,
      durationMs:
        tool?.startedAt === undefined
          ? undefined
          : Math.max(0, occurredAt - tool.startedAt),
      revision: (tool?.revision || 0) + 1,
    };
    this.setTraceBlock(turn, event.blockId, next);
    turn.desyncedAppendKeys.delete(`arguments:${event.blockId}`);
    turn.desyncedAppendKeys.delete(`progress:${event.blockId}`);
    turn.visible = true;
    return true;
  }

  private upsertNotice(
    turn: RunningTurnRecord,
    blockId: string,
    text: string,
  ): boolean {
    const current = turn.traceBlocks.get(blockId);
    if (current?.type === "notice" && current.text === text) return false;
    const next: RunningTurnNoticeBlock = {
      id: blockId,
      type: "notice",
      text,
      revision: (current?.revision || 0) + 1,
    };
    this.setTraceBlock(turn, blockId, next);
    turn.visible = true;
    return true;
  }

  private completeTurn(
    turn: RunningTurnRecord,
    authoritativeText: string,
    lifecycle: "completed" | "interrupted",
    occurredAt: number,
    reconcileText = true,
  ): boolean {
    let changed = this.freezeRunningTools(turn, occurredAt, lifecycle);
    if (reconcileText) {
      const finalText = this.getAnswerBlocks(turn)
        .map((block) => block.text)
        .filter(Boolean)
        .join("\n\n");
      if (finalText !== authoritativeText) {
        changed =
          this.replaceAuthoritativeFinalText(turn, authoritativeText) ||
          changed;
      }
    }
    changed = updateLifecycle(turn, lifecycle) || changed;
    turn.visible = true;
    return changed;
  }

  private failTurn(
    turn: RunningTurnRecord,
    error: string,
    occurredAt: number,
  ): boolean {
    let changed = this.freezeRunningTools(turn, occurredAt, "failed");
    changed = this.upsertNotice(turn, "turn-error", error) || changed;
    turn.visible = true;
    return updateLifecycle(turn, "failed") || changed;
  }

  private replaceAuthoritativeFinalText(
    turn: RunningTurnRecord,
    text: string,
  ): boolean {
    const finalIds = turn.contentOrder.filter((id) => {
      const block = turn.contentBlocks.get(id);
      return block && block.phase !== "commentary";
    });
    const blockId = finalIds[0] || "backend-final-response";
    let changed = this.replaceContent(turn, blockId, "final_answer", text);
    for (const extraId of finalIds.slice(1)) {
      const extra = turn.contentBlocks.get(extraId);
      if (!extra || !extra.text) continue;
      turn.contentBlocks.set(extraId, {
        ...extra,
        text: "",
        revision: extra.revision + 1,
      });
      changed = true;
    }
    return changed;
  }

  private freezeRunningTools(
    turn: RunningTurnRecord,
    occurredAt: number,
    _lifecycle: "completed" | "interrupted" | "failed",
  ): boolean {
    let changed = false;
    for (const blockId of turn.traceOrder) {
      const block = turn.traceBlocks.get(blockId);
      if (block?.type !== "tool" || block.status !== "running") continue;
      turn.traceBlocks.set(blockId, {
        ...block,
        status: "interrupted",
        durationMs:
          block.startedAt === undefined
            ? undefined
            : Math.max(0, occurredAt - block.startedAt),
        revision: block.revision + 1,
      });
      changed = true;
    }
    return changed;
  }

  private demoteCandidates(turn: RunningTurnRecord): void {
    for (const blockId of turn.candidateContentIds) {
      const current = turn.contentBlocks.get(blockId);
      if (!current || current.phase !== "candidate") continue;
      turn.contentBlocks.set(blockId, {
        ...current,
        phase: "commentary",
        revision: current.revision + 1,
      });
    }
    turn.candidateContentIds.clear();
  }

  private setTraceBlock(
    turn: RunningTurnRecord,
    blockId: string,
    block: RunningTurnTraceBlock,
  ): void {
    if (!turn.traceBlocks.has(blockId)) {
      turn.traceOrder.push(blockId);
      turn.streamOrder.push({ type: "trace", id: blockId });
    }
    turn.traceBlocks.set(blockId, block);
  }

  private getAnswerBlocks(
    turn: RunningTurnRecord,
  ): readonly RunningTurnContentBlock[] {
    if (
      turn.answerBlockCache &&
      turn.answerBlockCacheVersion === turn.stateVersion
    ) {
      return turn.answerBlockCache;
    }
    turn.answerBlockCache = turn.contentOrder.flatMap((blockId) => {
      const block = turn.contentBlocks.get(blockId);
      return block && block.phase !== "commentary" && block.text ? [block] : [];
    });
    turn.answerBlockCacheVersion = turn.stateVersion;
    return turn.answerBlockCache;
  }

  private getTraceBlocks(
    turn: RunningTurnRecord,
  ): readonly RunningTurnTraceBlock[] {
    if (
      turn.traceBlockCache &&
      turn.traceBlockCacheVersion === turn.stateVersion
    ) {
      return turn.traceBlockCache;
    }
    turn.traceBlockCache = turn.streamOrder.flatMap((entry) => {
      if (entry.type === "content") {
        const block = turn.contentBlocks.get(entry.id);
        if (!block || block.phase !== "commentary" || !block.text) return [];
        const previous = turn.commentaryViews.get(block.id);
        const commentary =
          previous?.type === "commentary" &&
          previous.revision === block.revision
            ? previous
            : {
                id: block.id,
                type: "commentary" as const,
                text: block.text,
                revision: block.revision,
              };
        turn.commentaryViews.set(block.id, commentary);
        return [commentary];
      }
      const block = turn.traceBlocks.get(entry.id);
      return block && !isEmptyTraceBlock(block) ? [block] : [];
    });
    turn.traceBlockCacheVersion = turn.stateVersion;
    return turn.traceBlockCache;
  }

  private invalidateCaches(turn: RunningTurnRecord): void {
    turn.answerBlockCache = undefined;
    turn.traceBlockCache = undefined;
  }
}

function updateRunIdentity(
  turn: RunningTurnRecord,
  event: Extract<AgentStreamEvent, { type: "turn.started" }>,
): boolean {
  const changed =
    turn.backendId !== event.backendId ||
    turn.providerProfileId !== event.providerProfileId ||
    turn.runId !== event.runId ||
    turn.turnId !== event.turnId ||
    turn.legacy !== event.legacy;
  turn.backendId = event.backendId;
  turn.providerProfileId = event.providerProfileId;
  turn.runId = event.runId;
  turn.turnId = event.turnId;
  turn.legacy = event.legacy;
  return changed;
}

function updateLifecycle(
  turn: RunningTurnRecord,
  lifecycle: RunningTurnLifecycle,
): boolean {
  if (turn.lifecycle === lifecycle) return false;
  turn.lifecycle = lifecycle;
  return true;
}

function updateCandidateMembership(
  turn: RunningTurnRecord,
  blockId: string,
  phase: AgentContentPhase,
): void {
  if (phase === "candidate") turn.candidateContentIds.add(blockId);
  else turn.candidateContentIds.delete(blockId);
}

function isAppendEvent(event: AgentStreamEvent): event is Extract<
  AgentStreamEvent,
  {
    type:
      | "content.append"
      | "reasoning.append"
      | "tool.arguments.append"
      | "tool.progress.append";
  }
> {
  return event.type.endsWith(".append");
}

function isImmediateEvent(event: AgentStreamEvent): boolean {
  return (
    event.type.startsWith("turn.") ||
    event.type === "tool.started" ||
    event.type === "tool.completed"
  );
}

function isTerminalTurnEvent(event: AgentStreamEvent): boolean {
  return (
    event.type === "turn.completed" ||
    event.type === "turn.interrupted" ||
    event.type === "turn.failed"
  );
}

function getAppendKey(
  event: Extract<
    AgentStreamEvent,
    {
      type:
        | "content.append"
        | "reasoning.append"
        | "tool.arguments.append"
        | "tool.progress.append";
    }
  >,
): string {
  switch (event.type) {
    case "content.append":
      return `content:${event.blockId}`;
    case "reasoning.append":
      return `reasoning:${event.blockId}`;
    case "tool.arguments.append":
      return `arguments:${event.blockId}`;
    case "tool.progress.append":
      return `progress:${event.blockId}`;
  }
}

function stripTraceRevision(block: RunningTurnTraceBlock): AgentTraceItem {
  const { revision: _revision, ...item } = block;
  return item;
}

function isEmptyTraceBlock(block: RunningTurnTraceBlock): boolean {
  if (block.type === "tool") return false;
  return !block.text;
}

function unchangedResult(): RunningTurnApplyResult {
  return {
    accepted: false,
    becameVisible: false,
    changed: false,
    immediate: false,
  };
}

export { RunningTurnStore };
export type {
  RunningTurnApplyResult,
  RunningTurnCreateInput,
  RunningTurnRecord,
};
