import type {
  AgentContentPhase,
  AgentTraceEvent,
} from "../../domain/agent/trace";
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
  eventSequence: number;
  messageItems: Map<string, CodexMessageItem>;
  resolve: (result: CodexPromptResult) => void;
  reject: (error: Error) => void;
  onDelta?: (delta: string) => void;
  onTraceEvent?: (event: AgentTraceEvent) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
  onTurnStarted?: (threadId: string, turnId: string) => void;
  timer: ReturnType<typeof setTimeout>;
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
    if (turn.turnId === turnId) return;
    this.remove(turn.threadId, turn.turnId);
    turn.turnId = turnId;
    this.turns.set(getTurnKey(turn), turn);
    turn.onTurnStarted?.(turn.threadId, turnId);
  }

  reject(threadId: string, turnId: string | undefined, error: unknown): void {
    const turn = this.find(threadId, turnId);
    if (!turn) return;
    this.remove(turn.threadId, turn.turnId);
    clearTimeout(turn.timer);
    turn.reject(toError(error));
  }

  rejectAll(error: unknown): void {
    for (const turn of this.turns.values()) {
      clearTimeout(turn.timer);
      turn.reject(toError(error));
    }
    this.turns.clear();
  }

  handleNotification(message: JsonRpcMessage): void {
    if (!("method" in message)) return;
    const turn = this.findForNotification(message.params);
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
        turn?.onNotice?.(warning);
        this.emit(turn, {
          type: "notice",
          itemId: nextSyntheticId(turn, "notice"),
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
        break;
    }
  }

  private handleAgentMessageDelta(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
  ): void {
    const delta = getNestedString(params, ["delta"]);
    if (!turn || !delta) return;
    const itemId = getItemId(params) || "codex-agent-message";
    const current = turn.messageItems.get(itemId);
    const phase = getContentPhase(params) || current?.phase || "candidate";
    turn.messageItems.set(itemId, {
      phase,
      text: `${current?.text || ""}${delta}`,
    });
    this.emit(turn, { type: "content.delta", itemId, phase, delta });
    turn.onDelta?.(delta);
  }

  private handleCommentaryDelta(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
    fallbackId: string,
  ): void {
    const delta = getNestedString(params, ["delta"]);
    if (!turn || !delta) return;
    this.emit(turn, {
      type: "content.delta",
      itemId: getItemId(params) || fallbackId,
      phase: "commentary",
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
    const itemId = `${getItemId(params) || "codex-reasoning"}:${kind}`;
    this.emit(turn, { type: "reasoning.delta", itemId, kind, delta });
  }

  private handleToolProgress(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
  ): void {
    if (!turn) return;
    const itemId = getItemId(params);
    if (!itemId) return;
    const delta =
      getNestedString(params, ["delta"]) ||
      getNestedString(params, ["message"]) ||
      getNestedString(params, ["progress"]);
    if (delta) {
      this.emit(turn, { type: "tool.progress", toolCallId: itemId, delta });
    }
    turn.onToolActivity?.();
  }

  private handleItem(
    turn: ActiveCodexTurn | undefined,
    params: JsonValue | undefined,
    completed: boolean,
  ): void {
    if (!turn) return;
    const item = getItem(params);
    const itemId = getItemId(params);
    const itemType = stringProperty(item, "type");
    if (!item || !itemId || !itemType) return;

    if (itemType === "agentMessage") {
      const phase = getContentPhase(item) || "candidate";
      const text = stringProperty(item, "text") || "";
      turn.messageItems.set(itemId, { phase, text });
      if (text || completed) {
        this.emit(turn, {
          type: "content.completed",
          itemId,
          phase,
          text,
        });
      }
      return;
    }

    if (itemType === "reasoning") {
      const summary = extractText(item.summary);
      const content = extractText(item.content);
      if (summary || completed) {
        this.emit(turn, {
          type: "reasoning.completed",
          itemId: `${itemId}:summary`,
          kind: "summary",
          text: summary,
        });
      }
      if (content) {
        this.emit(turn, {
          type: "reasoning.completed",
          itemId: `${itemId}:content`,
          kind: "content",
          text: content,
        });
      }
      return;
    }

    if (itemType === "plan") {
      const text = stringProperty(item, "text") || "";
      if (text) {
        this.emit(turn, {
          type: "content.completed",
          itemId,
          phase: "commentary",
          text,
        });
      }
      return;
    }

    if (!isOperationalItem(itemType)) return;
    this.demoteCandidateMessages(turn);
    const tool = parseToolItem(itemId, itemType, item);
    turn.onToolActivity?.();
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
        itemId,
        phase: "commentary",
      });
    }
  }

  private emit(
    turn: ActiveCodexTurn | undefined,
    event: AgentTraceEvent,
  ): void {
    turn?.onTraceEvent?.(event);
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
    clearTimeout(turn.timer);
    if (status && status !== "completed" && status !== "interrupted") {
      turn.reject(new Error(`Codex turn ${status}.`));
      return;
    }
    const text = [...turn.messageItems.values()]
      .filter((item) => item.phase !== "commentary")
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();
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
      turn?.onNotice?.(errorText);
      this.emit(turn, {
        type: "notice",
        itemId: nextSyntheticId(turn, "retry"),
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

function parseToolItem(
  itemId: string,
  itemType: string,
  item: JsonRecord,
): {
  toolCallId: string;
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
    toolCallId: itemId,
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
  turn.eventSequence += 1;
  return `${prefix}-${turn.eventSequence}`;
}

export { CodexTurnRegistry };
export type { ActiveCodexTurn };
