import { config, version } from "../../package.json";
import { buildCodexAppServerArguments } from "./appServerConfig";
import { buildCodexDeveloperInstructions } from "./developerInstructions";
import { buildCodexMcpServersConfig } from "./mcpConfig";
import { getUserHomeDirectory, resolveCodexBinaryPath } from "./binaryPath";
import type {
  CodexAccountReadResult,
  CodexBridgeStatus,
  CodexModelInfo,
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
  onTurnStarted?: (threadId: string, turnId: string) => void;
  timer: number;
  conversationId: string;
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
  private threadPromises = new Map<string, Promise<string>>();
  private conversationThreads = new Map<string, string>();
  private initialized = false;
  private activeTurns = new Map<string, ActiveTurn>();
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
    this.threadPromises.clear();
    this.conversationThreads.clear();
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

  async listModels(): Promise<CodexModelInfo[]> {
    await this.start();
    const result = await this.request("model/list", {
      limit: 100,
      includeHidden: false,
    });
    return parseModelList(result);
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.start();
    await this.request("turn/interrupt", { threadId, turnId }, 10000);
  }

  sendPrompt(
    prompt: string,
    options: CodexPromptOptions,
  ): Promise<CodexPromptResult> {
    return this.runPrompt(prompt, options);
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
    const cachedThreadId = this.conversationThreads.get(conversation.id);
    if (cachedThreadId) {
      return cachedThreadId;
    }
    const existing = this.threadPromises.get(conversation.id);
    if (existing) {
      return existing;
    }

    const promise = this.openConversationThread(conversation);
    this.threadPromises.set(conversation.id, promise);
    try {
      return await promise;
    } finally {
      this.threadPromises.delete(conversation.id);
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
    this.conversationThreads.set(conversation.id, id);
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
    this.conversationThreads.set(conversation.id, id);
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
        this.deleteActiveTurn(threadId);
        this.status = "error";
        reject(new Error("Codex request timed out."));
      }, this.getTimeoutMs());
      const activeTurn: ActiveTurn = {
        fullText: "",
        resolve,
        reject,
        onDelta: options.onDelta,
        onNotice: options.onNotice,
        onToolActivity: options.onToolActivity,
        onTurnStarted: options.onTurnStarted,
        timer,
        conversationId: options.conversation.id,
        threadId,
      };
      this.activeTurns.set(getTurnKey({ threadId }), activeTurn);
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
      if (options.model) {
        params.model = options.model;
      }
      if (options.effort) {
        params.reasoningEffort = options.effort;
        params.effort = options.effort;
      }

      const result = (await this.request(
        "turn/start",
        params,
        this.getTimeoutMs(),
      )) as { turn?: { id?: string } };
      const activeTurn = this.findActiveTurn(threadId);
      if (activeTurn && result?.turn?.id) {
        this.assignTurnId(activeTurn, result.turn.id);
      }
      const completed = await turnPromise;
      if (!this.activeTurns.size) {
        this.status = "ready";
      }
      return completed;
    } catch (error) {
      this.rejectActiveTurn(threadId, undefined, error);
      this.status = this.activeTurns.size ? "running" : "error";
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
    switch (message.method) {
      case "turn/started": {
        const turnId = getNestedString(message.params, ["turn", "id"]);
        const threadId = getNotificationThreadId(message.params);
        const activeTurn = this.findActiveTurn(threadId, turnId);
        if (activeTurn && turnId) {
          this.assignTurnId(activeTurn, turnId);
        }
        break;
      }
      case "item/agentMessage/delta": {
        const delta = getNestedString(message.params, ["delta"]);
        const activeTurn = this.findActiveTurnForNotification(message.params);
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
        const activeTurn = this.findActiveTurnForNotification(message.params);
        if (getNestedBoolean(message.params, ["willRetry"])) {
          activeTurn?.onNotice?.(errorText);
          ztoolkit.log("codex app-server retrying", errorText);
          break;
        }
        if (activeTurn) {
          this.rejectActiveTurn(
            activeTurn.threadId,
            activeTurn.turnId,
            new Error(errorText),
          );
        } else {
          this.clearActiveTurn(new Error(errorText));
        }
        this.status = this.activeTurns.size ? "running" : "error";
        break;
      }
      case "warning": {
        const warning =
          getNestedString(message.params, ["message"]) ||
          "Codex app-server warning.";
        const activeTurn = this.findActiveTurnForNotification(message.params);
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
        const activeTurn = this.findActiveTurnForNotification(message.params);
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
          const activeTurn = this.findActiveTurnForNotification(message.params);
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
    const activeTurn = this.findActiveTurnForNotification(params);
    if (!activeTurn) {
      return;
    }
    const status = getNestedString(params, ["turn", "status"]);
    this.deleteActiveTurn(activeTurn.threadId, activeTurn.turnId);
    this.clearTimer(activeTurn.timer);
    if (status && status !== "completed" && status !== "interrupted") {
      activeTurn.reject(new Error(`Codex turn ${status}.`));
      this.status = this.activeTurns.size ? "running" : "error";
      return;
    }
    activeTurn.resolve({
      threadId: activeTurn.threadId,
      turnId:
        activeTurn.turnId ||
        getNestedString(params, ["turn", "id"]) ||
        undefined,
      text: activeTurn.fullText.trim(),
      status: status === "interrupted" ? "interrupted" : "completed",
    });
    if (!this.activeTurns.size) {
      this.status = "ready";
    }
  }

  private clearActiveTurn(error: unknown): void {
    for (const activeTurn of this.activeTurns.values()) {
      this.clearTimer(activeTurn.timer);
      activeTurn.reject(toError(error));
    }
    this.activeTurns.clear();
  }

  private rejectActiveTurn(
    threadId: string,
    turnId: string | undefined,
    error: unknown,
  ): void {
    const activeTurn = this.findActiveTurn(threadId, turnId);
    if (!activeTurn) {
      return;
    }
    this.deleteActiveTurn(activeTurn.threadId, activeTurn.turnId);
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
      this.threadPromises.clear();
      this.conversationThreads.clear();
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

  private assignTurnId(activeTurn: ActiveTurn, turnId: string): void {
    if (activeTurn.turnId === turnId) {
      return;
    }
    this.deleteActiveTurn(activeTurn.threadId, activeTurn.turnId);
    activeTurn.turnId = turnId;
    this.activeTurns.set(getTurnKey(activeTurn), activeTurn);
    activeTurn.onTurnStarted?.(activeTurn.threadId, turnId);
  }

  private findActiveTurnForNotification(
    params: JsonValue | undefined,
  ): ActiveTurn | undefined {
    return this.findActiveTurn(
      getNotificationThreadId(params),
      getNotificationTurnId(params),
    );
  }

  private findActiveTurn(
    threadId?: string,
    turnId?: string,
  ): ActiveTurn | undefined {
    if (threadId && turnId) {
      const exact = this.activeTurns.get(getTurnKey({ threadId, turnId }));
      if (exact) {
        return exact;
      }
    }
    if (threadId) {
      const pending = this.activeTurns.get(getTurnKey({ threadId }));
      if (pending) {
        return pending;
      }
      for (const activeTurn of this.activeTurns.values()) {
        if (activeTurn.threadId === threadId) {
          return activeTurn;
        }
      }
    }
    if (turnId) {
      for (const activeTurn of this.activeTurns.values()) {
        if (activeTurn.turnId === turnId) {
          return activeTurn;
        }
      }
    }
    if (this.activeTurns.size === 1) {
      return Array.from(this.activeTurns.values())[0];
    }
    return undefined;
  }

  private deleteActiveTurn(threadId: string, turnId?: string): void {
    this.activeTurns.delete(getTurnKey({ threadId, turnId }));
    this.activeTurns.delete(getTurnKey({ threadId }));
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

function getNotificationThreadId(
  value: JsonValue | undefined,
): string | undefined {
  return (
    getNestedString(value, ["thread", "id"]) ||
    getNestedString(value, ["threadId"]) ||
    getNestedString(value, ["thread_id"]) ||
    getNestedString(value, ["turn", "threadId"]) ||
    getNestedString(value, ["turn", "thread_id"]) ||
    getNestedString(value, ["item", "threadId"]) ||
    getNestedString(value, ["item", "thread_id"])
  );
}

function getNotificationTurnId(
  value: JsonValue | undefined,
): string | undefined {
  return (
    getNestedString(value, ["turn", "id"]) ||
    getNestedString(value, ["turnId"]) ||
    getNestedString(value, ["turn_id"]) ||
    getNestedString(value, ["item", "turnId"]) ||
    getNestedString(value, ["item", "turn_id"])
  );
}

function getTurnKey(value: { threadId: string; turnId?: string }): string {
  return value.turnId
    ? `${value.threadId}\u0000${value.turnId}`
    : `${value.threadId}\u0000`;
}

function parseModelList(value: JsonValue | undefined): CodexModelInfo[] {
  const modelsValue = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? value.data || value.models
      : undefined;
  if (!Array.isArray(modelsValue)) {
    return [];
  }
  return modelsValue
    .map((item) => parseModelInfo(item))
    .filter((item): item is CodexModelInfo => Boolean(item));
}

function parseModelInfo(value: JsonValue): CodexModelInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const slug =
    stringProperty(value, "slug") ||
    stringProperty(value, "id") ||
    stringProperty(value, "model");
  if (!slug) {
    return null;
  }
  return {
    slug,
    displayName:
      stringProperty(value, "displayName") ||
      stringProperty(value, "display_name") ||
      stringProperty(value, "name") ||
      slug,
    defaultReasoningEffort:
      stringProperty(value, "defaultReasoningEffort") ||
      stringProperty(value, "default_reasoning_level"),
    supportedReasoningEfforts:
      arrayOfStringsProperty(value, "supportedReasoningEfforts") ||
      arrayOfStringsProperty(value, "supported_reasoning_levels") ||
      [],
  };
}

function stringProperty(
  value: { [key: string]: JsonValue },
  key: string,
): string | undefined {
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}

function arrayOfStringsProperty(
  value: { [key: string]: JsonValue },
  key: string,
): string[] | undefined {
  const property = value[key];
  if (!Array.isArray(property)) {
    return undefined;
  }
  return property
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return (
          stringProperty(item, "reasoningEffort") ||
          stringProperty(item, "effort")
        );
      }
      return undefined;
    })
    .filter((item): item is string => typeof item === "string");
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
