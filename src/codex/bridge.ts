import { config, version } from "../../package.json";
import { buildCodexAppServerArguments } from "./appServerConfig";
import { buildCodexDeveloperInstructions } from "./developerInstructions";
import { buildCodexMcpServersConfig } from "./mcpConfig";
import { getUserHomeDirectory, resolveCodexBinaryPath } from "./binaryPath";
import type {
  CodexAccountReadResult,
  CodexBridgeStatus,
  CodexPromptOptions,
  CodexPromptResult,
  CodexSubprocessModule,
  CodexSubprocessProcess,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonValue,
} from "./types";
import { getPref } from "../utils/prefs";
import type { ConversationMetadata } from "../shared/conversation";

type PendingRequest = {
  method: string;
  resolve: (result: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer: number;
};

type ActiveTurn = {
  fullText: string;
  resolve: (result: CodexPromptResult) => void;
  reject: (error: Error) => void;
  onDelta?: (delta: string, fullText: string) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
  timer: number;
  threadId: string;
  turnId?: string;
};

export { CodexBridge, getCodexBridge, shutdownCodexBridge };

class CodexBridge {
  private subprocess?: CodexSubprocessModule;
  private process?: CodexSubprocessProcess;
  private nextRequestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private startPromise?: Promise<void>;
  private threadPromise?: Promise<string>;
  private initialized = false;
  private activeConversationId?: string;
  private activeThreadId?: string;
  private activeTurn?: ActiveTurn;
  private promptQueue: Promise<void> = Promise.resolve();
  private status: CodexBridgeStatus = "idle";

  getStatus(): CodexBridgeStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.initialized && this.process) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.status = "starting";
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    this.initialized = false;
    this.activeConversationId = undefined;
    this.activeThreadId = undefined;
    this.threadPromise = undefined;
    this.rejectAll(new Error("Codex app-server stopped."));
    const proc = this.process;
    this.process = undefined;
    if (!proc) {
      this.status = "idle";
      return;
    }
    try {
      await proc.stdin.close().catch(() => undefined);
      await proc.kill(500).catch(() => undefined);
    } finally {
      this.status = "idle";
    }
  }

  async readAccount(): Promise<CodexAccountReadResult> {
    await this.start();
    const result = await this.request("account/read", {});
    return result as CodexAccountReadResult;
  }

  async prewarm(): Promise<void> {
    await this.start();
  }

  sendPrompt(
    prompt: string,
    options: CodexPromptOptions,
  ): Promise<CodexPromptResult> {
    const queued = this.promptQueue.then(() => this.runPrompt(prompt, options));
    this.promptQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async startProcess(): Promise<void> {
    const subprocess = this.getSubprocess();
    const command = await resolveCodexBinaryPath(subprocess);
    const proc = await subprocess.call({
      command,
      arguments: buildCodexAppServerArguments(),
      environmentAppend: true,
      stderr: "pipe",
      workdir: getUserHomeDirectory(subprocess.getEnvironment()),
    });

    this.subprocess = subprocess;
    this.process = proc;
    this.readStdout(proc);
    this.readStderr(proc);
    this.watchExit(proc);

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "zotero_copilot",
          title: config.addonName,
          version,
        },
        capabilities: {
          experimentalApi: true,
        },
      });
      await this.notify("initialized");
      this.initialized = true;
      this.status = "ready";
    } catch (error) {
      this.process = undefined;
      await proc.kill(500).catch(() => undefined);
      this.status = "error";
      throw error;
    }
  }

  private async ensureThread(
    conversation: ConversationMetadata,
  ): Promise<string> {
    await this.start();
    if (this.activeConversationId === conversation.id && this.activeThreadId) {
      return this.activeThreadId;
    }
    if (this.threadPromise) {
      return this.threadPromise;
    }

    this.threadPromise = this.openConversationThread(conversation);
    try {
      return await this.threadPromise;
    } finally {
      this.threadPromise = undefined;
    }
  }

  private async openConversationThread(
    conversation: ConversationMetadata,
  ): Promise<string> {
    if (conversation.codexThreadId) {
      try {
        return await this.resumeThread(conversation);
      } catch (error) {
        ztoolkit.log(
          "codex thread/resume failed; starting replacement thread",
          String(error),
        );
      }
    }
    return this.createThread(conversation);
  }

  private async createThread(
    conversation: ConversationMetadata,
  ): Promise<string> {
    const result = (await this.callThreadMethod(
      "thread/start",
      this.buildThreadParams({ ephemeral: false }),
    )) as {
      thread?: { id?: string };
    };
    const id = result?.thread?.id;
    if (!id) {
      throw new Error("Codex app-server did not return a thread id.");
    }
    this.activeConversationId = conversation.id;
    this.activeThreadId = id;
    this.logMcpServerStatus();
    return id;
  }

  private async resumeThread(
    conversation: ConversationMetadata,
  ): Promise<string> {
    const result = (await this.callThreadMethod(
      "thread/resume",
      this.buildThreadParams({ threadId: conversation.codexThreadId || "" }),
    )) as {
      thread?: { id?: string };
    };
    const id = result?.thread?.id || conversation.codexThreadId;
    if (!id) {
      throw new Error("Codex app-server did not resume a thread id.");
    }
    this.activeConversationId = conversation.id;
    this.activeThreadId = id;
    this.logMcpServerStatus();
    return id;
  }

  private buildThreadParams(extra: { [key: string]: JsonValue }): {
    [key: string]: JsonValue;
  } {
    const cwd = this.getHomeCwd();
    const params: { [key: string]: JsonValue } = {
      ...extra,
    };
    if (cwd) {
      params.cwd = cwd;
    }
    params.developerInstructions = buildCodexDeveloperInstructions();
    return params;
  }

  private async addMcpConfig(params: {
    [key: string]: JsonValue;
  }): Promise<{ [key: string]: JsonValue }> {
    const mcpServers = await buildCodexMcpServersConfig().catch((error) => {
      ztoolkit.log("codex mcp config unavailable", String(error));
      return undefined;
    });
    if (mcpServers) {
      params.config = {
        mcp_servers: mcpServers,
      };
      ztoolkit.log("codex thread/start mcp config injected", {
        servers: Object.keys(mcpServers),
      });
    }
    return params;
  }

  private async callThreadMethod(
    method: "thread/start" | "thread/resume",
    params: { [key: string]: JsonValue },
  ): Promise<JsonValue | undefined> {
    const fullParams = await this.addMcpConfig(params);
    try {
      return await this.request(method, fullParams);
    } catch (error) {
      if (!isDeveloperInstructionsUnsupportedError(error)) {
        throw error;
      }
      const fallbackParams = { ...fullParams };
      delete fallbackParams.developerInstructions;
      ztoolkit.log(
        `${method} developerInstructions unsupported; retrying without visible fallback`,
      );
      return this.request(method, fallbackParams);
    }
  }

  private async runPrompt(
    prompt: string,
    options: CodexPromptOptions,
  ): Promise<CodexPromptResult> {
    const threadId = await this.ensureThread(options.conversation);
    this.status = "running";

    const turnPromise = new Promise<CodexPromptResult>((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.activeTurn = undefined;
        this.status = "error";
        reject(new Error("Codex request timed out."));
      }, this.getTimeoutMs());
      this.activeTurn = {
        fullText: "",
        resolve,
        reject,
        onDelta: options.onDelta,
        onNotice: options.onNotice,
        onToolActivity: options.onToolActivity,
        timer,
        threadId,
      };
    });

    try {
      const params: { [key: string]: JsonValue } = {
        threadId,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
        ],
      };
      const cwd = this.getHomeCwd();
      if (cwd) {
        params.cwd = cwd;
      }

      const result = (await this.request(
        "turn/start",
        params,
        this.getTimeoutMs(),
      )) as { turn?: { id?: string } };
      if (this.activeTurn && result?.turn?.id) {
        this.activeTurn.turnId = result.turn.id;
      }
      const completed = await turnPromise;
      this.status = "ready";
      return completed;
    } catch (error) {
      this.clearActiveTurn(error);
      this.status = "error";
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
      throw new Error("Codex app-server is not running.");
    }
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const message = { id, method, params };

    const promise = new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer = this.setTimer(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timer,
      });
    });

    try {
      await proc.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        this.clearTimer(pending.timer);
      }
      throw error;
    }
    return promise;
  }

  private async notify(method: string, params?: JsonValue): Promise<void> {
    const proc = this.process;
    if (!proc) {
      throw new Error("Codex app-server is not running.");
    }
    const message = params === undefined ? { method } : { method, params };
    await proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private readStdout(proc: CodexSubprocessProcess): void {
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

  private readStderr(proc: CodexSubprocessProcess): void {
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
        ztoolkit.log("codex app-server stderr", line);
      }
      newlineIndex = this.stderrBuffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      ztoolkit.log("invalid codex app-server JSON", line, error);
      return;
    }

    if ("id" in message && "method" in message) {
      this.rejectServerRequest(message as JsonRpcRequest);
      return;
    }
    if ("id" in message) {
      this.handleResponse(message as JsonRpcResponse);
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
    this.clearTimer(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(
          `${pending.method}: ${message.error.message || "Codex error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private rejectServerRequest(message: JsonRpcRequest): void {
    const method = message.method || "unknown";
    const response = {
      id: message.id,
      error: {
        code: -32601,
        message: `Zotero Copilot does not support app-server request: ${method}`,
      },
    };
    void this.process?.stdin.write(`${JSON.stringify(response)}\n`);
  }

  private handleNotification(message: JsonRpcMessage): void {
    if (!("method" in message)) {
      return;
    }
    const activeTurn = this.activeTurn;
    switch (message.method) {
      case "turn/started": {
        const turnId = getNestedString(message.params, ["turn", "id"]);
        if (activeTurn && turnId) {
          activeTurn.turnId = turnId;
        }
        break;
      }
      case "item/agentMessage/delta": {
        const delta = getNestedString(message.params, ["delta"]);
        if (activeTurn && delta) {
          activeTurn.fullText += delta;
          activeTurn.onDelta?.(delta, activeTurn.fullText);
        }
        break;
      }
      case "turn/completed": {
        this.completeActiveTurn(message.params);
        break;
      }
      case "error": {
        const errorText = formatServerError(message.params);
        if (getNestedBoolean(message.params, ["willRetry"])) {
          activeTurn?.onNotice?.(errorText);
          ztoolkit.log("codex app-server retrying", errorText);
          break;
        }
        this.clearActiveTurn(new Error(errorText));
        this.status = "error";
        break;
      }
      case "warning": {
        const warning =
          getNestedString(message.params, ["message"]) ||
          "Codex app-server warning.";
        activeTurn?.onNotice?.(warning);
        ztoolkit.log("codex app-server warning", warning);
        break;
      }
      case "mcpServer/startupStatus/updated": {
        ztoolkit.log(
          "codex mcp startup status",
          summarizeJsonForLog(message.params),
        );
        break;
      }
      case "item/mcpToolCall/progress": {
        activeTurn?.onToolActivity?.();
        ztoolkit.log(
          "codex mcp tool progress",
          summarizeJsonForLog(message.params),
        );
        break;
      }
      case "item/started":
      case "item/completed": {
        if (includesText(message.params, "mcpToolCall")) {
          activeTurn?.onToolActivity?.();
          ztoolkit.log(
            `codex mcp tool item ${message.method}`,
            summarizeJsonForLog(message.params),
          );
        }
        break;
      }
      default:
        break;
    }
  }

  private logMcpServerStatus(): void {
    void this.request("mcpServerStatus/list", {}, 10000)
      .then((result) => {
        ztoolkit.log(
          "codex mcp server status list",
          summarizeJsonForLog(result),
        );
      })
      .catch((error) => {
        ztoolkit.log("codex mcp server status list failed", String(error));
      });
  }

  private completeActiveTurn(params: JsonValue | undefined): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn) {
      return;
    }
    const status = getNestedString(params, ["turn", "status"]);
    this.activeTurn = undefined;
    this.clearTimer(activeTurn.timer);
    if (status && status !== "completed") {
      activeTurn.reject(new Error(`Codex turn ${status}.`));
      this.status = "error";
      return;
    }
    activeTurn.resolve({
      threadId: activeTurn.threadId,
      turnId:
        activeTurn.turnId ||
        getNestedString(params, ["turn", "id"]) ||
        undefined,
      text: activeTurn.fullText.trim(),
    });
  }

  private clearActiveTurn(error: unknown): void {
    const activeTurn = this.activeTurn;
    if (!activeTurn) {
      return;
    }
    this.activeTurn = undefined;
    this.clearTimer(activeTurn.timer);
    activeTurn.reject(toError(error));
  }

  private watchExit(proc: CodexSubprocessProcess): void {
    void proc.wait().then(({ exitCode }) => {
      if (this.process !== proc) {
        return;
      }
      this.process = undefined;
      this.initialized = false;
      this.activeConversationId = undefined;
      this.activeThreadId = undefined;
      this.status = "error";
      this.rejectAll(new Error(`Codex app-server exited (${exitCode}).`));
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      this.clearTimer(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.clearActiveTurn(error);
  }

  private getSubprocess(): CodexSubprocessModule {
    if (this.subprocess) {
      return this.subprocess;
    }
    const imported = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as { Subprocess: CodexSubprocessModule };
    this.subprocess = imported.Subprocess;
    return this.subprocess;
  }

  private getTimeoutMs(): number {
    const value = Number(getPref("codex.timeoutMs"));
    if (!Number.isFinite(value) || value < 1000) {
      return 180000;
    }
    return value;
  }

  private getHomeCwd(): string | undefined {
    const environment = this.subprocess?.getEnvironment();
    return environment ? getUserHomeDirectory(environment) : undefined;
  }

  private setTimer(callback: () => void, delay: number): number {
    return setTimeout(callback, delay) as unknown as number;
  }

  private clearTimer(timer: number): void {
    clearTimeout(timer);
  }
}

let sharedBridge: CodexBridge | undefined;

function getCodexBridge(): CodexBridge {
  sharedBridge ??= new CodexBridge();
  return sharedBridge;
}

async function shutdownCodexBridge(): Promise<void> {
  const bridge = sharedBridge;
  sharedBridge = undefined;
  await bridge?.stop();
}

function getNestedString(
  value: JsonValue | undefined,
  path: string[],
): string | undefined {
  const current = getNestedValue(value, path);
  return typeof current === "string" ? current : undefined;
}

function getNestedBoolean(
  value: JsonValue | undefined,
  path: string[],
): boolean | undefined {
  const current = getNestedValue(value, path);
  return typeof current === "boolean" ? current : undefined;
}

function getNestedValue(
  value: JsonValue | undefined,
  path: string[],
): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function formatServerError(params: JsonValue | undefined): string {
  const message =
    getNestedString(params, ["error", "message"]) ||
    getNestedString(params, ["message"]) ||
    "Codex app-server reported an error.";
  const details =
    getNestedString(params, ["error", "additionalDetails"]) ||
    getNestedString(params, ["additionalDetails"]);
  return [message, details].filter(Boolean).join("\n");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isDeveloperInstructionsUnsupportedError(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error);
  return (
    message.includes("developerInstructions") &&
    /(unsupported|unknown|unrecognized|invalid)/i.test(message)
  );
}

function summarizeJsonForLog(
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = JSON.stringify(value);
  if (text.length <= 4000) {
    return value;
  }
  return `${text.slice(0, 4000)}...`;
}

function includesText(value: JsonValue | undefined, needle: string): boolean {
  if (value === undefined) {
    return false;
  }
  return JSON.stringify(value).includes(needle);
}
