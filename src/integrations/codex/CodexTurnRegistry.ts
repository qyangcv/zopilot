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
  includesText,
  summarizeJsonForLog,
  toError,
} from "./messageParsing";

type ActiveCodexTurn = {
  fullText: string;
  resolve: (result: CodexPromptResult) => void;
  reject: (error: Error) => void;
  onDelta?: (delta: string) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
  onTurnStarted?: (threadId: string, turnId: string) => void;
  timer: ReturnType<typeof setTimeout>;
  threadId: string;
  turnId?: string;
};

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
    switch (message.method) {
      case "turn/started": {
        const turnId = getNestedString(message.params, ["turn", "id"]);
        const turn = this.find(getNotificationThreadId(message.params), turnId);
        if (turn && turnId) this.assignTurnId(turn, turnId);
        break;
      }
      case "item/agentMessage/delta": {
        const delta = getNestedString(message.params, ["delta"]);
        const turn = this.findForNotification(message.params);
        if (turn && delta) {
          turn.fullText += delta;
          turn.onDelta?.(delta);
        }
        break;
      }
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
        const turn = this.findForNotification(message.params);
        turn?.onNotice?.(warning);
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
      case "item/mcpToolCall/progress": {
        this.findForNotification(message.params)?.onToolActivity?.();
        logger.debug(
          "codex mcp tool progress",
          summarizeJsonForLog(message.params),
        );
        break;
      }
      case "item/started":
      case "item/completed":
        if (includesText(message.params, "mcpToolCall")) {
          this.findForNotification(message.params)?.onToolActivity?.();
          logger.debug(
            `codex mcp tool item ${message.method}`,
            summarizeJsonForLog(message.params),
          );
        }
        break;
      default:
        break;
    }
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
    turn.resolve({
      threadId: turn.threadId,
      turnId:
        turn.turnId || getNestedString(params, ["turn", "id"]) || undefined,
      text: turn.fullText.trim(),
      status: status === "interrupted" ? "interrupted" : "completed",
    });
  }

  private handleError(params: JsonValue | undefined): void {
    const errorText = formatServerError(params);
    const turn = this.findForNotification(params);
    if (getNestedBoolean(params, ["willRetry"])) {
      turn?.onNotice?.(errorText);
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

export { CodexTurnRegistry };
export type { ActiveCodexTurn };
