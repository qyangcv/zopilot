import { config, version } from "../../package.json";
import {
  encodeJsonRpcMessage,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../codex/jsonRpc";
import { PAPER_BINDING_MISSING_MESSAGE } from "../mcp/paperBinding";
import { createPaperReadTool } from "../mcp/tools/paperRead";
import type { JsonValue } from "../codex/types";
import type { ConversationMetadata } from "../shared/conversation";
import { createLogger } from "../utils/logger";
import {
  buildByokRuntimeEnvironment,
  resolveNodeBinaryPath,
} from "./nodeDiscovery";
import type {
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  ProviderProfileWithSecret,
} from "../agent/types";

export { ByokRuntimeBridge, getByokRuntimeBridge, shutdownByokRuntimeBridge };

type ByokSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<ByokSubprocessProcess>;
  getEnvironment(): Record<string, string>;
};

type ByokSubprocessProcess = {
  stdin: {
    write(buffer: string): Promise<unknown>;
    close(force?: boolean): Promise<unknown>;
  };
  stdout: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

type PendingRequest = {
  method: string;
  resolve: (result: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveTurn = {
  callbacks: AgentPromptCallbacks;
  fullText: string;
  runId: string;
};

const logger = createLogger("byok.runtime");
const RUNTIME_FILE_NAME = "byok-runtime.cjs";
type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;
type AddonInstanceWithRoot = {
  data?: {
    rootURI?: string;
  };
};

class ByokRuntimeBridge {
  private subprocess?: ByokSubprocessModule;
  private process?: ByokSubprocessProcess;
  private nextRequestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private activeTurns = new Map<string, ActiveTurn>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private startPromise?: Promise<void>;
  private initialized = false;

  async stop(): Promise<void> {
    this.initialized = false;
    this.rejectAll(new Error("BYOK runtime stopped."));
    const proc = this.process;
    this.process = undefined;
    if (!proc) {
      return;
    }
    await proc.stdin.close().catch(() => undefined);
    await proc.kill(500).catch(() => undefined);
  }

  async listModels(
    profile: ProviderProfileWithSecret,
  ): Promise<AgentModelEntry[]> {
    await this.start();
    const result = await this.request(
      "model/list",
      { profile: sanitizeProfileForRuntime(profile) },
      profile.timeoutMs,
    );
    return Array.isArray(result) ? (result as AgentModelEntry[]) : [];
  }

  async sendPrompt(
    profile: ProviderProfileWithSecret,
    input: AgentPromptInput,
    callbacks: AgentPromptCallbacks = {},
  ): Promise<AgentRunResult> {
    await this.start();
    const runId = createRunId();
    callbacks.onRunStarted?.({
      backendId: profile.id,
      providerProfileId: profile.id,
      runId,
    });
    this.activeTurns.set(runId, {
      callbacks,
      fullText: "",
      runId,
    });
    try {
      const result = await this.request(
        "turn/start",
        {
          runId,
          profile: sanitizeProfileForRuntime(profile),
          input,
        },
        profile.timeoutMs + 1000,
      );
      return parseRunResult(result, profile, runId);
    } finally {
      this.activeTurns.delete(runId);
    }
  }

  async interruptTurn(runId: string): Promise<void> {
    await this.start();
    await this.request("turn/interrupt", { runId }, 10000);
  }

  private async start(): Promise<void> {
    if (this.initialized && this.process) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startProcess(): Promise<void> {
    const subprocess = this.getSubprocess();
    const environment = await buildByokRuntimeEnvironment(subprocess);
    const command = await resolveNodeBinaryPath(environment.PATH);
    const runtimePath = await ensureRuntimeFile();
    const proc = await subprocess.call({
      command,
      arguments: [runtimePath],
      environment,
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
      workdir: subprocess.getEnvironment().HOME,
    });

    this.subprocess = subprocess;
    this.process = proc;
    this.readStdout(proc);
    this.readStderr(proc);
    this.watchExit(proc);

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "zopilot",
          title: config.addonName,
          version,
        },
      });
      this.initialized = true;
    } catch (error) {
      this.process = undefined;
      await proc.kill(500).catch(() => undefined);
      throw error;
    }
  }

  private async request(
    method: string,
    params?: JsonValue,
    timeoutMs = 30000,
  ): Promise<JsonValue | undefined> {
    const proc = this.process;
    if (!proc) {
      throw new Error("BYOK runtime is not running.");
    }
    const id = this.nextRequestId++;
    const message = { id, method, params };
    const promise = new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`BYOK runtime request timed out: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timer,
      });
    });
    try {
      await proc.stdin.write(encodeJsonRpcMessage(message));
    } catch (error) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        clearTimeout(pending.timer);
      }
      throw error;
    }
    return promise;
  }

  private readStdout(proc: ByokSubprocessProcess): void {
    void (async () => {
      while (this.process === proc) {
        const chunk = await proc.stdout.readString().catch(() => "");
        if (!chunk) {
          break;
        }
        this.stdoutBuffer += chunk;
        this.flushStdoutBuffer();
      }
    })();
  }

  private readStderr(proc: ByokSubprocessProcess): void {
    const stderr = proc.stderr;
    if (!stderr) {
      return;
    }
    void (async () => {
      while (this.process === proc) {
        const chunk = await stderr.readString().catch(() => "");
        if (!chunk) {
          break;
        }
        this.stderrBuffer += chunk;
        this.flushStderrBuffer();
      }
    })();
  }

  private flushStdoutBuffer(): void {
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private flushStderrBuffer(): void {
    let newlineIndex = this.stderrBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stderrBuffer.slice(0, newlineIndex).trim();
      this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
      if (line) {
        logger.warn("BYOK runtime stderr", { line });
      }
      newlineIndex = this.stderrBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcMessage(line);
    } catch (error) {
      logger.warn("invalid BYOK runtime JSON", {
        line,
        error: String(error),
      });
      return;
    }
    if (isJsonRpcRequest(message)) {
      void this.handleRuntimeRequest(message);
      return;
    }
    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }
    this.handleNotification(message);
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(
          `${pending.method}: ${message.error.message || "BYOK runtime error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private async handleRuntimeRequest(message: JsonRpcRequest): Promise<void> {
    try {
      if (message.method !== "tool/paper_read") {
        throw new Error(`Unsupported BYOK runtime request: ${message.method}`);
      }
      const result = await callPaperRead(message.params);
      await this.process?.stdin.write(
        encodeJsonRpcMessage({
          id: message.id,
          result,
        }),
      );
    } catch (error) {
      await this.process?.stdin.write(
        encodeJsonRpcMessage({
          id: message.id,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    }
  }

  private handleNotification(message: JsonRpcMessage): void {
    if (!("method" in message)) {
      return;
    }
    const runId = getRunId(message.params);
    const activeTurn = runId ? this.activeTurns.get(runId) : undefined;
    switch (message.method) {
      case "item/agentMessage/delta": {
        const delta = getNestedString(message.params, ["delta"]);
        if (activeTurn && delta) {
          activeTurn.fullText += delta;
          activeTurn.callbacks.onTextDelta?.(delta);
        }
        break;
      }
      case "item/tool/started": {
        activeTurn?.callbacks.onToolStarted?.(
          getNestedString(message.params, ["name"]) || "tool",
        );
        break;
      }
      case "item/tool/completed": {
        activeTurn?.callbacks.onToolCompleted?.(
          getNestedString(message.params, ["name"]) || "tool",
        );
        break;
      }
      case "warning": {
        const warning = getNestedString(message.params, ["message"]);
        if (warning) {
          activeTurn?.callbacks.onNotice?.(warning);
          logger.warn("BYOK runtime warning", { warning, runId });
        }
        break;
      }
      default:
        break;
    }
  }

  private watchExit(proc: ByokSubprocessProcess): void {
    void proc.wait().then(({ exitCode }) => {
      if (this.process !== proc) {
        return;
      }
      this.process = undefined;
      this.initialized = false;
      this.rejectAll(new Error(`BYOK runtime exited (${exitCode}).`));
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.activeTurns.clear();
  }

  private getSubprocess(): ByokSubprocessModule {
    if (this.subprocess) {
      return this.subprocess;
    }
    const imported = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as { Subprocess: ByokSubprocessModule };
    this.subprocess = imported.Subprocess;
    return this.subprocess;
  }
}

let sharedBridge: ByokRuntimeBridge | undefined;

function getByokRuntimeBridge(): ByokRuntimeBridge {
  sharedBridge ??= new ByokRuntimeBridge();
  return sharedBridge;
}

async function shutdownByokRuntimeBridge(): Promise<void> {
  const bridge = sharedBridge;
  sharedBridge = undefined;
  await bridge?.stop();
}

async function ensureRuntimeFile(): Promise<string> {
  const runtimeDir = PathUtils.join(
    (Zotero as typeof Zotero & { Profile: { dir: string } }).Profile.dir,
    "zopilot",
    "runtime",
  );
  await IOUtils.makeDirectory(runtimeDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const runtimePath = PathUtils.join(runtimeDir, RUNTIME_FILE_NAME);
  const response = await fetch(
    getAddonRootURI() + `content/scripts/${RUNTIME_FILE_NAME}`,
  );
  if (!response.ok) {
    throw new Error(`Unable to load BYOK runtime bundle: ${response.status}`);
  }
  await IOUtils.writeUTF8(runtimePath, await response.text(), { flush: true });
  return runtimePath;
}

function getAddonRootURI(): string {
  const globals = globalThis as unknown as Record<string, unknown>;
  const globalRootURI =
    typeof globals.rootURI === "string" ? globals.rootURI : undefined;
  if (globalRootURI) {
    return globalRootURI;
  }
  const addonInstance = (Zotero as ZoteroPluginRegistry)[
    config.addonInstance
  ] as AddonInstanceWithRoot | undefined;
  const storedRootURI = addonInstance?.data?.rootURI;
  if (storedRootURI) {
    return storedRootURI;
  }
  throw new Error("BYOK runtime bundle root URI is unavailable.");
}

async function callPaperRead(
  params: JsonValue | undefined,
): Promise<JsonValue> {
  const value = isObject(params) ? params : {};
  const conversation = value.conversation as ConversationMetadata | undefined;
  if (!conversation) {
    throw new Error("BYOK runtime paper_read request has no conversation.");
  }
  const toolInput = isJsonValue(value.input) ? value.input : {};
  const result = await createPaperReadTool().call(toolInput, {
    workspaceScope: {
      conversationId: conversation.id,
      workspaceKey: conversation.workspaceKey,
      workspaceType: conversation.workspaceType,
      workspaceLabel: conversation.workspaceLabel,
      libraryID: conversation.libraryID,
      collectionKey: conversation.collectionKey,
      collectionPath: conversation.collectionPath,
      itemKey: conversation.itemKey,
      defaultSource: conversation.defaultSource
        ? {
            paperKey: conversation.defaultSource.paperKey,
            libraryID: conversation.defaultSource.libraryID,
            parentItemID: conversation.defaultSource.parentItemID,
            parentItemKey: conversation.defaultSource.parentItemKey,
            attachmentItemID: conversation.defaultSource.attachmentItemID,
            attachmentKey: conversation.defaultSource.attachmentKey,
            title: conversation.defaultSource.title,
          }
        : undefined,
    },
    paperBindingError: conversation.defaultSource
      ? undefined
      : PAPER_BINDING_MISSING_MESSAGE,
  });
  return {
    text: result.content
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n\n"),
    isError: Boolean(result.isError),
  };
}

function sanitizeProfileForRuntime(
  profile: ProviderProfileWithSecret,
): JsonValue {
  return JSON.parse(JSON.stringify(profile)) as JsonValue;
}

function parseRunResult(
  result: JsonValue | undefined,
  profile: ProviderProfileWithSecret,
  runId: string,
): AgentRunResult {
  if (isObject(result) && typeof result.text === "string") {
    return {
      backendId: profile.id,
      providerProfileId: profile.id,
      runId,
      text: result.text,
      status: result.status === "interrupted" ? "interrupted" : "completed",
    };
  }
  return {
    backendId: profile.id,
    providerProfileId: profile.id,
    runId,
    text: "",
    status: "completed",
  };
}

function getRunId(value: JsonValue | undefined): string | undefined {
  return getNestedString(value, ["runId"]);
}

function getNestedString(
  value: JsonValue | undefined,
  path: string[],
): string | undefined {
  let current: unknown = value;
  for (const item of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[item];
  }
  return typeof current === "string" ? current : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function createRunId(): string {
  return `run.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
