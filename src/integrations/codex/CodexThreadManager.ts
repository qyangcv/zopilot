import { buildCodexDeveloperInstructions } from "../../application/agent/prompt/developerInstructions";
import type { ConversationMetadata } from "../../domain/conversation";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import { buildCodexMcpServersConfig } from "./mcpConfig";

type CodexThreadManagerOptions = {
  start: () => Promise<void>;
  request: (
    method: string,
    params?: JsonValue,
  ) => Promise<JsonValue | undefined>;
  getCwd: () => string | undefined;
};

const logger = createLogger("codex.threads");

class CodexThreadManager {
  private readonly pending = new Map<string, Promise<string>>();
  private readonly threads = new Map<string, string>();

  constructor(private readonly options: CodexThreadManagerOptions) {}

  clear(): void {
    this.pending.clear();
    this.threads.clear();
  }

  async ensure(conversation: ConversationMetadata): Promise<string> {
    await this.options.start();
    const cached = this.threads.get(conversation.id);
    if (cached) return cached;
    const existing = this.pending.get(conversation.id);
    if (existing) return existing;
    const promise = this.openConversation(conversation);
    this.pending.set(conversation.id, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(conversation.id);
    }
  }

  private async openConversation(
    conversation: ConversationMetadata,
  ): Promise<string> {
    if (conversation.codexThreadId) {
      try {
        return await this.open(
          "thread/resume",
          { threadId: conversation.codexThreadId },
          conversation,
          conversation.codexThreadId,
        );
      } catch (error) {
        logger.error(
          "codex thread/resume failed; starting replacement thread",
          error,
          {
            conversationId: conversation.id,
            threadId: conversation.codexThreadId,
          },
        );
      }
    }
    return this.open("thread/start", { ephemeral: false }, conversation);
  }

  private async open(
    method: "thread/start" | "thread/resume",
    extraParams: { [key: string]: JsonValue },
    conversation: ConversationMetadata,
    fallbackThreadId?: string,
  ): Promise<string> {
    const mcpServers = await buildCodexMcpServersConfig(conversation);
    const params: { [key: string]: JsonValue } = {
      ...extraParams,
      developerInstructions: buildCodexDeveloperInstructions(),
      config: { mcp_servers: mcpServers },
    };
    const cwd = this.options.getCwd();
    if (cwd) params.cwd = cwd;
    logger.debug(`codex ${method} mcp config injected`, {
      servers: Object.keys(mcpServers),
    });
    const result = (await this.options.request(method, params)) as {
      thread?: { id?: string };
    };
    const threadId = result?.thread?.id || fallbackThreadId;
    if (!threadId) {
      throw new Error(`Codex app-server did not return a ${method} thread id.`);
    }
    this.threads.set(conversation.id, threadId);
    return threadId;
  }
}

export { CodexThreadManager };
export type { CodexThreadManagerOptions };
