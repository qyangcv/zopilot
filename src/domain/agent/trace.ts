export type AgentContentPhase = "commentary" | "final_answer" | "candidate";

export type AgentReasoningKind = "content" | "summary";

export type AgentToolStatus = "running" | "completed" | "failed";

export type AgentTraceEvent =
  | {
      type: "content.delta";
      itemId: string;
      phase: AgentContentPhase;
      delta: string;
    }
  | {
      type: "content.completed";
      itemId: string;
      phase: AgentContentPhase;
      text: string;
    }
  | {
      type: "content.phase";
      itemId: string;
      phase: AgentContentPhase;
    }
  | {
      type: "reasoning.delta";
      itemId: string;
      kind: AgentReasoningKind;
      delta: string;
    }
  | {
      type: "reasoning.completed";
      itemId: string;
      kind: AgentReasoningKind;
      text: string;
    }
  | {
      type: "tool.started";
      toolCallId: string;
      name: string;
      server?: string;
      arguments?: string;
    }
  | {
      type: "tool.arguments.delta";
      toolCallId: string;
      delta: string;
    }
  | {
      type: "tool.progress";
      toolCallId: string;
      delta: string;
    }
  | {
      type: "tool.completed";
      toolCallId: string;
      name?: string;
      server?: string;
      arguments?: string;
      result?: string;
      error?: string;
    }
  | {
      type: "notice";
      itemId: string;
      text: string;
    };

export type AgentTraceItem =
  | {
      id: string;
      type: "reasoning";
      kind: AgentReasoningKind;
      text: string;
    }
  | {
      id: string;
      type: "commentary";
      text: string;
    }
  | {
      id: string;
      type: "tool";
      name: string;
      server?: string;
      arguments?: string;
      progress?: string;
      result?: string;
      error?: string;
      status: AgentToolStatus;
      startedAt?: number;
      durationMs?: number;
    }
  | {
      id: string;
      type: "notice";
      text: string;
    };

type AgentContentBlock = {
  id: string;
  type: "content";
  phase: AgentContentPhase;
  text: string;
};

type AgentReasoningBlock = Extract<AgentTraceItem, { type: "reasoning" }>;
type AgentToolBlock = Extract<AgentTraceItem, { type: "tool" }>;
type AgentNoticeBlock = Extract<AgentTraceItem, { type: "notice" }>;

export type AgentTurnTraceBlock =
  | AgentContentBlock
  | AgentReasoningBlock
  | AgentToolBlock
  | AgentNoticeBlock;

export type AgentTurnTraceState = {
  blocks: AgentTurnTraceBlock[];
};

export type AgentTurnTraceProjection = {
  finalStarted: boolean;
  finalText: string;
  trace: AgentTraceItem[];
};

export function createAgentTurnTraceState(): AgentTurnTraceState {
  return { blocks: [] };
}

export function reduceAgentTraceEvent(
  state: AgentTurnTraceState,
  event: AgentTraceEvent,
  occurredAt = Date.now(),
): AgentTurnTraceState {
  let blocks = [...state.blocks];

  switch (event.type) {
    case "content.delta":
    case "content.completed": {
      const index = blocks.findIndex(
        (block) => block.type === "content" && block.id === event.itemId,
      );
      const current = index >= 0 ? blocks[index] : undefined;
      const text =
        event.type === "content.completed"
          ? event.text
          : `${current?.type === "content" ? current.text : ""}${event.delta}`;
      const next: AgentContentBlock = {
        id: event.itemId,
        type: "content",
        phase: event.phase,
        text,
      };
      blocks = replaceOrAppend(blocks, index, next);
      break;
    }
    case "content.phase": {
      blocks = blocks.map((block) =>
        block.type === "content" && block.id === event.itemId
          ? { ...block, phase: event.phase }
          : block,
      );
      break;
    }
    case "reasoning.delta":
    case "reasoning.completed": {
      const index = blocks.findIndex(
        (block) => block.type === "reasoning" && block.id === event.itemId,
      );
      const current = index >= 0 ? blocks[index] : undefined;
      const text =
        event.type === "reasoning.completed"
          ? event.text
          : `${current?.type === "reasoning" ? current.text : ""}${event.delta}`;
      const next: AgentReasoningBlock = {
        id: event.itemId,
        type: "reasoning",
        kind: event.kind,
        text,
      };
      blocks = replaceOrAppend(blocks, index, next);
      break;
    }
    case "tool.started": {
      blocks = demoteCandidateContent(blocks);
      const index = blocks.findIndex(
        (block) => block.type === "tool" && block.id === event.toolCallId,
      );
      const current = index >= 0 ? blocks[index] : undefined;
      const next: AgentToolBlock = {
        id: event.toolCallId,
        type: "tool",
        name: event.name,
        server: event.server,
        arguments:
          event.arguments ??
          (current?.type === "tool" ? current.arguments : undefined),
        progress: current?.type === "tool" ? current.progress : undefined,
        result: current?.type === "tool" ? current.result : undefined,
        error: current?.type === "tool" ? current.error : undefined,
        status: "running",
        startedAt:
          current?.type === "tool"
            ? (current.startedAt ?? occurredAt)
            : occurredAt,
        durationMs: undefined,
      };
      blocks = replaceOrAppend(blocks, index, next);
      break;
    }
    case "tool.arguments.delta":
    case "tool.progress": {
      const index = blocks.findIndex(
        (block) => block.type === "tool" && block.id === event.toolCallId,
      );
      if (index < 0 || blocks[index]?.type !== "tool") {
        break;
      }
      const current = blocks[index] as AgentToolBlock;
      blocks[index] =
        event.type === "tool.arguments.delta"
          ? {
              ...current,
              arguments: `${current.arguments || ""}${event.delta}`,
            }
          : {
              ...current,
              progress: `${current.progress || ""}${event.delta}`,
            };
      break;
    }
    case "tool.completed": {
      blocks = demoteCandidateContent(blocks);
      const index = blocks.findIndex(
        (block) => block.type === "tool" && block.id === event.toolCallId,
      );
      const current = index >= 0 ? blocks[index] : undefined;
      const next: AgentToolBlock = {
        id: event.toolCallId,
        type: "tool",
        name: event.name || (current?.type === "tool" ? current.name : "tool"),
        server:
          event.server ??
          (current?.type === "tool" ? current.server : undefined),
        arguments:
          event.arguments ??
          (current?.type === "tool" ? current.arguments : undefined),
        progress: current?.type === "tool" ? current.progress : undefined,
        result: event.result,
        error: event.error,
        status: event.error ? "failed" : "completed",
        startedAt: current?.type === "tool" ? current.startedAt : undefined,
        durationMs:
          current?.type === "tool" && current.startedAt !== undefined
            ? Math.max(0, occurredAt - current.startedAt)
            : undefined,
      };
      blocks = replaceOrAppend(blocks, index, next);
      break;
    }
    case "notice": {
      const index = blocks.findIndex(
        (block) => block.type === "notice" && block.id === event.itemId,
      );
      blocks = replaceOrAppend(blocks, index, {
        id: event.itemId,
        type: "notice",
        text: event.text,
      });
      break;
    }
  }

  return { blocks };
}

export function projectAgentTurnTrace(
  state: AgentTurnTraceState,
): AgentTurnTraceProjection {
  const finalBlocks = state.blocks.filter(
    (block): block is AgentContentBlock =>
      block.type === "content" && block.phase !== "commentary",
  );
  const trace = state.blocks.flatMap((block): AgentTraceItem[] => {
    if (block.type === "content") {
      return block.phase === "commentary" && block.text
        ? [{ id: block.id, type: "commentary", text: block.text }]
        : [];
    }
    if (
      (block.type === "reasoning" ||
        block.type === "notice" ||
        block.type === "tool") &&
      !isEmptyTraceBlock(block)
    ) {
      return [block];
    }
    return [];
  });
  const finalText = finalBlocks
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
  return {
    finalStarted: finalBlocks.some((block) => Boolean(block.text)),
    finalText,
    trace,
  };
}

export function isAgentTraceItem(value: unknown): value is AgentTraceItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Partial<AgentTraceItem> & Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.type !== "string") {
    return false;
  }
  if (item.type === "reasoning") {
    return (
      (item.kind === "content" || item.kind === "summary") &&
      typeof item.text === "string"
    );
  }
  if (item.type === "commentary" || item.type === "notice") {
    return typeof item.text === "string";
  }
  if (item.type === "tool") {
    return (
      typeof item.name === "string" &&
      (item.status === "running" ||
        item.status === "completed" ||
        item.status === "failed") &&
      optionalString(item.server) &&
      optionalString(item.arguments) &&
      optionalString(item.progress) &&
      optionalString(item.result) &&
      optionalString(item.error) &&
      optionalNonNegativeNumber(item.startedAt) &&
      optionalNonNegativeNumber(item.durationMs)
    );
  }
  return false;
}

function demoteCandidateContent(
  blocks: AgentTurnTraceBlock[],
): AgentTurnTraceBlock[] {
  return blocks.map((block) =>
    block.type === "content" && block.phase === "candidate"
      ? { ...block, phase: "commentary" }
      : block,
  );
}

function replaceOrAppend<T extends AgentTurnTraceBlock>(
  blocks: AgentTurnTraceBlock[],
  index: number,
  next: T,
): AgentTurnTraceBlock[] {
  if (index < 0) {
    return [...blocks, next];
  }
  const copy = [...blocks];
  copy[index] = next;
  return copy;
}

function isEmptyTraceBlock(block: AgentTraceItem): boolean {
  if (block.type === "tool") {
    return false;
  }
  return !block.text;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}
