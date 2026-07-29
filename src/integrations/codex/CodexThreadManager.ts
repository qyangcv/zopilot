import { buildCodexDeveloperInstructions } from "../../application/agent/prompt/developerInstructions";
import type {
  ProviderCheckpoint,
  ThreadHistoryItem,
  ThreadRunInput,
} from "../../domain/thread";
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
  buildMcpServersConfig?: typeof buildCodexMcpServersConfig;
};

type OpenedCodexThread = {
  threadId: string;
  checkpoint: ProviderCheckpoint;
};

const CODEX_ADAPTER_KEY = "codex-cli";
const logger = createLogger("codex.threads");

class CodexThreadManager {
  private readonly pending = new Map<string, Promise<OpenedCodexThread>>();

  constructor(private readonly options: CodexThreadManagerOptions) {}

  clear(): void {
    this.pending.clear();
  }

  async ensure(
    run: ThreadRunInput,
    onCheckpoint?: (checkpoint: ProviderCheckpoint) => Promise<void>,
  ): Promise<OpenedCodexThread> {
    await this.options.start();
    const existing = this.pending.get(run.threadId);
    if (existing) return existing;
    const promise = this.openAndSynchronize(run, onCheckpoint);
    this.pending.set(run.threadId, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(run.threadId);
    }
  }

  private async openAndSynchronize(
    run: ThreadRunInput,
    onCheckpoint?: (checkpoint: ProviderCheckpoint) => Promise<void>,
  ): Promise<OpenedCodexThread> {
    const binding =
      run.binding?.adapterKey === CODEX_ADAPTER_KEY ? run.binding : undefined;
    let threadId: string;
    let syncedThroughSequence = 0;
    let replacement = !binding || binding.state === "dirty";

    if (binding && binding.state === "clean") {
      try {
        threadId = await this.open(
          "thread/resume",
          { threadId: binding.externalThreadId },
          run,
        );
        if (threadId === binding.externalThreadId) {
          syncedThroughSequence = binding.syncedThroughSequence;
        } else {
          replacement = true;
        }
      } catch (error) {
        replacement = true;
        logger.error(
          "codex thread/resume failed; rebuilding a replacement thread",
          error,
          {
            threadId: run.threadId,
            externalThreadId: binding.externalThreadId,
          },
        );
        threadId = await this.open("thread/start", { ephemeral: false }, run);
      }
    } else {
      threadId = await this.open("thread/start", { ephemeral: false }, run);
    }

    let checkpoint = createCheckpoint(threadId, syncedThroughSequence);
    if (replacement) {
      await onCheckpoint?.(checkpoint);
    }

    const missingHistory = run.history.filter(
      (item) => item.sequence > syncedThroughSequence,
    );
    if (missingHistory.length) {
      await this.options.request("thread/inject_items", {
        threadId,
        items: historyToCodexItems(missingHistory),
      });
      checkpoint = createCheckpoint(threadId, missingHistory.at(-1)!.sequence);
      await onCheckpoint?.(checkpoint);
    }

    return { threadId, checkpoint };
  }

  private async open(
    method: "thread/start" | "thread/resume",
    extraParams: { [key: string]: JsonValue },
    run: ThreadRunInput,
  ): Promise<string> {
    const mcpServers = await (
      this.options.buildMcpServersConfig || buildCodexMcpServersConfig
    )(run);
    const params: { [key: string]: JsonValue } = {
      ...extraParams,
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: buildCodexDeveloperInstructions(),
      config: { mcp_servers: mcpServers },
    };
    const cwd = this.options.getCwd();
    if (cwd) params.cwd = cwd;
    logger.debug(`codex ${method} mcp config injected`, {
      servers: Object.keys(mcpServers),
      threadId: run.threadId,
    });
    const result = (await this.options.request(method, params)) as {
      thread?: { id?: string };
    };
    const threadId = result?.thread?.id;
    if (!threadId) {
      throw new Error(`Codex app-server did not return a ${method} thread id.`);
    }
    return threadId;
  }
}

function createCheckpoint(
  externalThreadId: string,
  syncedThroughSequence: number,
): ProviderCheckpoint {
  return {
    adapterKey: CODEX_ADAPTER_KEY,
    externalThreadId,
    syncedThroughSequence,
    state: "clean",
  };
}

function historyToCodexItems(history: ThreadHistoryItem[]): JsonValue[] {
  return history.flatMap((item) => [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: item.userText }],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: item.assistantText }],
    },
  ]);
}

export { CodexThreadManager };
export type { CodexThreadManagerOptions, OpenedCodexThread };
