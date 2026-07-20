import type { AgentContentPhase } from "../../domain/agent/trace";
import type {
  AgentStreamEvent,
  AgentStreamEventInput,
} from "../../domain/agent/streaming";
import type { JsonRpcMessage } from "../../runtime/json-rpc/protocol";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import type { CodexPromptResult } from "./types";
import {
  formatServerError,
  getNestedBoolean,
  getNestedString,
  getNotificationThreadId,
  getNotificationTurnId,
  getTurnKey,
  summarizeJsonForLog,
  toError,
} from "./messageParsing";

type CodexMessageItem = {
  phase: AgentContentPhase;
  text: string;
};

type ActiveCodexTurn = {
  anonymousBlockIds: Map<string, string>;
  backendId: string;
  eventSequence: number;
  messageItems: Map<string, CodexMessageItem>;
  onEvent?: (event: AgentStreamEvent) => void;
  providerProfileId: string;
  resolve: (result: CodexPromptResult) => void;
  reject: (error: Error) => void;
  started: boolean;
  streamLengths: Map<string, number>;
  syntheticIdSequence: number;
  threadId: string;
  turnId?: string;
};

type JsonRecord = { [key: string]: JsonValue };

const logger = createLogger("codex.turns");

class CodexTurnRegistry {
  private readonly turns = new Map<string, ActiveCodexTurn>();

  add(turn: ActiveCodexTurn): void {
    this.turns.set(getTurnKey(turn), turn);
  }

  remove(threadId: string, turnId?: string): void {
    this.turns.delete(getTurnKey({ threadId, turnId }));
    this.turns.delete(getTurnKey({ threadId }));
  }

  find(threadId?: string, turnId?: string): ActiveCodexTurn | undefined {
    if (threadId && turnId) {
      const exact = this.turns.get(getTurnKey({ threadId, turnId }));
      if (exact) return exact;
    }
    if (threadId) {
      const pending = this.turns.get(getTurnKey({ threadId }));
      if (pending) return pending;
      for (const turn of this.turns.values()) {
        if (turn.threadId === threadId) return turn;
      }
    }
    if (turnId) {
      for (const turn of this.turns.values()) {
        if (turn.turnId === turnId) return turn;
      }
    }
    return undefined;
  }

  assignTurnId(turn: ActiveCodexTurn, turnId: string): void {
    if (turn.turnId !== turnId) {
      this.remove(turn.threadId, turn.turnId);
      turn.turnId = turnId;
      this.turns.set(getTurnKey(turn), turn);
    }
    if (turn.started) return;
    turn.started = true;
    this.emit(turn, {
      type: "turn.started",
      backendId: turn.backendId,
      providerProfileId: turn.providerProfileId,
      runId: turn.threadId,
      turnId,
      legacy: {
        codexThreadId: turn.threadId,
        codexTurnId: turnId,
      },
    });
  }

  reject(threadId: string, turnId: string | undefined, error: unknown): void {
    const turn = this.find(threadId, turnId);
    if (!turn) return;
    this.remove(turn.threadId, turn.turnId);
    const normalized = toError(error);
    this.emit(turn, { type: "turn.failed", error: normalized.message });
    turn.reject(normalized);
  }

  rejectAll(error: unknown): void {
    for (const turn of this.turns.values()) {
      const normalized = toError(error);
      this.emit(turn, { type: "turn.failed", error: normalized.message });
      turn.reject(normalized);
    }
    this.turns.clear();
  }

  handleNotification(message: JsonRpcMessage): void {
    if (!("method" in message)) return;
    const turn = this.findForNotification(message.params);
    const notificationTurnId = getNotificationTurnId(message.params);
    if (turn && !turn.started && notificationTurnId) {
      this.assignTurnId(turn, notificationTurnId);
    }
    switch (message.method) {
      case "turn/started": {
        const turnId = getNestedString(message.params, ["turn", "id"]);
        const startedTurn = this.find(
          getNotificationThreadId(message.params),
          turnId,
        );
        if (startedTurn && turnId) this.assignTurnId(startedTurn, turnId);
        break;
      }
      case "item/agentMessage/delta":
        this.handleAgentMessageDelta(turn, message.params);
        break;
      case "item/plan/delta":
        this.handleCommentaryDelta(turn, message.params, "plan");
        break;
      case "item/reasoning/summaryTextDelta":
        this.handleReasoningDelta(turn, message.params, "summary");
        break;
      case "item/reasoning/textDelta":
        this.handleReasoningDelta(turn, message.params, "content");
        break;
      case "item/commandExecution/outputDelta":
      case "item/mcpToolCall/progress":
        this.handleToolProgress(turn, message.params);
        break;
      case "item/started":
        this.handleItem(turn, message.params, false);
        break;
      case "item/completed":
        this.handleItem(turn, message.params, true);
        break;
      case "turn/completed":
        this.complete(message.params);
        break;
      case "error":
        this.handleError(message.params);
        break;
      case "warning": {
        const warning =
          getNestedString(message.params, ["message"]) ||
          "Codex app-server warning.";
        this.emit(turn, {
          type: "notice.upsert",
          blockId: nextSyntheticId(turn, "notice"),
          text: warning,
        });
        logger.warn("codex app-server warning", {
          warning,
          threadId: turn?.threadId,
          turnId: turn?.turnId,
        });
        break;
      }
      case "mcpServer/startupStatus/updated":
        logger.debug(
          "codex mcp startup status",
          summarizeJsonForLog(message.params),
        );
        break;
      default:
        if (getItem(message.params)) {
          this.handleItem(
            turn,
            message.params,
            message.method.toLowerCase().includes("completed"),
          );
        }
        break;
    }
  }

  private handleAgentMessageDelta(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
  ): void {
    const delta = getNestedString(params, ["delta"]);
    if (!turn || !delta) return;
    const itemId = this.getStableBlockId(turn, params, "agent-message");
    const current = turn.messageItems.get(itemId);
    const phase = getContentPhase(params) || current?.phase || "candidate";
    const expectedOffset = current?.text.length || 0;
    turn.messageItems.set(itemId, {
      phase,
      text: `${current?.text || ""}${delta}`,
    });
    this.setStreamLength(
      turn,
      contentStreamKey(itemId),
      expectedOffset + delta.length,
    );
    this.emit(turn, {
      type: "content.append",
      blockId: itemId,
      phase,
      expectedOffset,
      delta,
    });
  }

  private handleCommentaryDelta(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
    fallbackId: string,
  ): void {
    const delta = getNestedString(params, ["delta"]);
    if (!turn || !delta) return;
    const blockId = this.getStableBlockId(
      turn,
      params,
      `commentary:${fallbackId}`,
    );
    const streamKey = contentStreamKey(blockId);
    const expectedOffset = this.getStreamLength(turn, streamKey);
    this.setStreamLength(turn, streamKey, expectedOffset + delta.length);
    this.emit(turn, {
      type: "content.append",
      blockId,
      phase: "commentary",
      expectedOffset,
      delta,
    });
  }

  private handleReasoningDelta(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
    kind: "content" | "summary",
  ): void {
    const delta = getNestedString(params, ["delta"]);
    if (!turn || !delta) return;
    const blockId = `${this.getStableBlockId(
      turn,
      params,
      `reasoning:${kind}`,
    )}:${kind}`;
    const streamKey = reasoningStreamKey(blockId);
    const expectedOffset = this.getStreamLength(turn, streamKey);
    this.setStreamLength(turn, streamKey, expectedOffset + delta.length);
    this.emit(turn, {
      type: "reasoning.append",
      blockId,
      kind,
      expectedOffset,
      delta,
    });
  }

  private handleToolProgress(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
  ): void {
    if (!turn) return;
    const itemId = this.getStableBlockId(turn, params, "tool");
    const delta =
      getNestedString(params, ["delta"]) ||
      getNestedString(params, ["message"]) ||
      getNestedString(params, ["progress"]);
    if (delta) {
      const streamKey = toolProgressStreamKey(itemId);
      const expectedOffset = this.getStreamLength(turn, streamKey);
      this.setStreamLength(turn, streamKey, expectedOffset + delta.length);
      this.emit(turn, {
        type: "tool.progress.append",
        blockId: itemId,
        expectedOffset,
        delta,
      });
    }
  }

  private handleItem(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
    completed: boolean,
  ): void {
    if (!turn) return;
    const item = getItem(params);
    const itemType = stringProperty(item, "type");
    if (!item || !itemType) return;
    const channel = getItemChannel(itemType);

    if (itemType === "agentMessage") {
      const itemId = this.getStableBlockId(turn, params, channel);
      const phase = getContentPhase(item) || "candidate";
      const text = stringProperty(item, "text") || "";
      turn.messageItems.set(itemId, { phase, text });
      this.setStreamLength(turn, contentStreamKey(itemId), text.length);
      if (text || completed) {
        this.emit(turn, {
          type: "content.replace",
          blockId: itemId,
          phase,
          text,
        });
      }
      if (completed) turn.anonymousBlockIds.delete(channel);
      return;
    }

    if (itemType === "reasoning") {
      const summary = extractText(item.summary);
      const content = extractText(item.content);
      if (summary || completed) {
        const blockId = `${this.getStableBlockId(
          turn,
          params,
          "reasoning:summary",
        )}:summary`;
        this.setStreamLength(turn, reasoningStreamKey(blockId), summary.length);
        this.emit(turn, {
          type: "reasoning.replace",
          blockId,
          kind: "summary",
          text: summary,
        });
      }
      if (content) {
        const blockId = `${this.getStableBlockId(
          turn,
          params,
          "reasoning:content",
        )}:content`;
        this.setStreamLength(turn, reasoningStreamKey(blockId), content.length);
        this.emit(turn, {
          type: "reasoning.replace",
          blockId,
          kind: "content",
          text: content,
        });
      }
      if (completed) {
        turn.anonymousBlockIds.delete("reasoning:summary");
        turn.anonymousBlockIds.delete("reasoning:content");
      }
      return;
    }

    if (itemType === "plan") {
      const itemId = this.getStableBlockId(turn, params, channel);
      const text = stringProperty(item, "text") || "";
      if (text) {
        this.setStreamLength(turn, contentStreamKey(itemId), text.length);
        this.emit(turn, {
          type: "content.replace",
          blockId: itemId,
          phase: "commentary",
          text,
        });
      }
      if (completed) turn.anonymousBlockIds.delete(channel);
      return;
    }

    if (!isOperationalItem(itemType)) return;
    const itemId = this.getStableBlockId(turn, params, channel);
    this.demoteCandidateMessages(turn);
    const tool = parseToolItem(itemId, itemType, item);
    if (tool.arguments) {
      this.setStreamLength(
        turn,
        toolArgumentsStreamKey(itemId),
        tool.arguments.length,
      );
    }
    if (!completed) {
      this.emit(turn, { type: "tool.started", ...tool });
      return;
    }
    this.emit(turn, {
      type: "tool.completed",
      ...tool,
      result: parseToolResult(itemType, item),
      error: parseToolError(item),
    });
    turn.anonymousBlockIds.delete(channel);
    logger.debug(
      `codex ${itemType} ${completed ? "completed" : "started"}`,
      summarizeJsonForLog(params),
    );
  }

  private demoteCandidateMessages(turn: ActiveCodexTurn): void {
    for (const [itemId, message] of turn.messageItems) {
      if (message.phase !== "candidate") continue;
      turn.messageItems.set(itemId, { ...message, phase: "commentary" });
      this.emit(turn, {
        type: "content.phase",
        blockId: itemId,
        phase: "commentary",
      });
    }
  }

  private emit(
    turn: ActiveCodexTurn | undefined,
    event: AgentStreamEventInput,
  ): void {
    if (!turn) return;
    turn.eventSequence += 1;
    turn.onEvent?.({
      ...event,
      sequence: turn.eventSequence,
    } as AgentStreamEvent);
  }

  private getStreamLength(turn: ActiveCodexTurn, key: string): number {
    return turn.streamLengths.get(key) || 0;
  }

  private setStreamLength(
    turn: ActiveCodexTurn,
    key: string,
    length: number,
  ): void {
    turn.streamLengths.set(key, length);
  }

  private getStableBlockId(
    turn: ActiveCodexTurn,
    params: JsonValue | undefined,
    channel: string,
  ): string {
    const explicit = getItemId(params);
    if (explicit) {
      turn.anonymousBlockIds.set(channel, explicit);
      return explicit;
    }
    const current = turn.anonymousBlockIds.get(channel);
    if (current) return current;
    const generated = nextSyntheticId(turn, channel);
    turn.anonymousBlockIds.set(channel, generated);
    return generated;
  }

  private findForNotification(
    params: JsonValue | undefined,
  ): ActiveCodexTurn | undefined {
    return this.find(
      getNotificationThreadId(params),
      getNotificationTurnId(params),
    );
  }

  private complete(params: JsonValue | undefined): void {
    const turn = this.findForNotification(params);
    if (!turn) return;
    const status = getNestedString(params, ["turn", "status"]);
    this.remove(turn.threadId, turn.turnId);
    if (status && status !== "completed" && status !== "interrupted") {
      const error = new Error(`Codex turn ${status}.`);
      this.emit(turn, { type: "turn.failed", error: error.message });
      turn.reject(error);
      return;
    }
    const text = [...turn.messageItems.values()]
      .filter((item) => item.phase !== "commentary")
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();
    this.emit(turn, {
      type: status === "interrupted" ? "turn.interrupted" : "turn.completed",
      text,
    });
    turn.resolve({
      threadId: turn.threadId,
      turnId:
        turn.turnId || getNestedString(params, ["turn", "id"]) || undefined,
      text,
      status: status === "interrupted" ? "interrupted" : "completed",
    });
  }

  private handleError(params: JsonValue | undefined): void {
    const errorText = formatServerError(params);
    const turn = this.findForNotification(params);
    if (getNestedBoolean(params, ["willRetry"])) {
      this.emit(turn, {
        type: "notice.upsert",
        blockId: nextSyntheticId(turn, "retry"),
        text: errorText,
      });
      logger.warn("codex app-server retrying", {
        error: errorText,
        threadId: turn?.threadId,
        turnId: turn?.turnId,
      });
      return;
    }
    if (turn) {
      logger.error("codex app-server error", new Error(errorText), {
        threadId: turn.threadId,
        turnId: turn.turnId,
      });
      this.reject(turn.threadId, turn.turnId, new Error(errorText));
      return;
    }
    logger.error("codex app-server error", new Error(errorText));
    this.rejectAll(new Error(errorText));
  }
}

function getItem(params: JsonValue | undefined): JsonRecord | undefined {
  const record = asRecord(params);
  return asRecord(record?.item);
}

function getItemId(params: JsonValue | undefined): string | undefined {
  return (
    getNestedString(params, ["itemId"]) ||
    getNestedString(params, ["item", "id"])
  );
}

function getContentPhase(
  value: JsonValue | undefined,
): AgentContentPhase | undefined {
  const phase = getNestedString(value, ["phase"]);
  return phase === "commentary" || phase === "final_answer" ? phase : undefined;
}

function isOperationalItem(type: string): boolean {
  return [
    "mcpToolCall",
    "dynamicToolCall",
    "collabToolCall",
    "commandExecution",
    "fileChange",
    "webSearch",
    "imageView",
  ].includes(type);
}

function getItemChannel(itemType: string): string {
  if (itemType === "agentMessage") return "agent-message";
  if (itemType === "reasoning") return "reasoning:item";
  if (itemType === "plan") return "commentary:plan";
  return "tool";
}

function parseToolItem(
  itemId: string,
  itemType: string,
  item: JsonRecord,
): {
  blockId: string;
  name: string;
  server?: string;
  arguments?: string;
} {
  const name =
    stringProperty(item, "tool") ||
    stringProperty(item, "command") ||
    stringProperty(item, "query") ||
    (itemType === "fileChange" ? "file_change" : undefined) ||
    (itemType === "imageView" ? "view_image" : undefined) ||
    itemType;
  const argumentValue =
    item.arguments ??
    item.command ??
    item.query ??
    item.changes ??
    item.action ??
    item.path;
  return {
    blockId: itemId,
    name,
    server: stringProperty(item, "server"),
    arguments: formatJson(argumentValue),
  };
}

function parseToolResult(
  itemType: string,
  item: JsonRecord,
): string | undefined {
  const value =
    item.result ??
    item.aggregatedOutput ??
    item.output ??
    (itemType === "fileChange" ? item.changes : undefined);
  return formatJson(value);
}

function parseToolError(item: JsonRecord): string | undefined {
  const error = item.error;
  if (typeof error === "string") return error;
  const record = asRecord(error);
  return stringProperty(record, "message") || formatJson(error);
}

function extractText(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("\n\n");
  }
  const record = asRecord(value);
  if (!record) return "";
  return (
    stringProperty(record, "text") || stringProperty(record, "content") || ""
  );
}

function formatJson(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function asRecord(value: JsonValue | undefined): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function stringProperty(
  value: JsonRecord | undefined,
  key: string,
): string | undefined {
  const property = value?.[key];
  return typeof property === "string" ? property : undefined;
}

function nextSyntheticId(
  turn: ActiveCodexTurn | undefined,
  prefix: string,
): string {
  if (!turn) return `${prefix}-unknown`;
  turn.syntheticIdSequence += 1;
  return `${prefix}-${turn.syntheticIdSequence}`;
}

function contentStreamKey(blockId: string): string {
  return `content:${blockId}`;
}

function reasoningStreamKey(blockId: string): string {
  return `reasoning:${blockId}`;
}

function toolArgumentsStreamKey(blockId: string): string {
  return `tool-arguments:${blockId}`;
}

function toolProgressStreamKey(blockId: string): string {
  return `tool-progress:${blockId}`;
}

export { CodexTurnRegistry };
export type { ActiveCodexTurn };
