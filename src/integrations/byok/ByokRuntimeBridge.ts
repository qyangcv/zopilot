import { config, version } from "../../../package.json";
import type {
  JsonRpcMessage,
  JsonRpcRequest,
} from "../../runtime/json-rpc/protocol";
import type { JsonValue } from "../../runtime/json/types";
import { createLogger } from "../../runtime/logging/logger";
import {
  buildByokRuntimeEnvironment,
  resolveNodeBinaryPath,
} from "./runtime/nodeDiscovery";
import { getHomeDir } from "../../runtime/platform/host";
import type {
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  ProviderProfileWithSecret,
} from "../../domain/agent/types";
import { StdioJsonRpcPeer } from "../../runtime/json-rpc/StdioJsonRpcPeer";
import type {
  StdioSubprocess,
  StdioSubprocessModule,
} from "../../runtime/process/types";
import { callPaperRead } from "./paperReadGateway";
import { ensureRuntimeFile } from "./runtime/runtimeBundle";
import {
  createRunId,
  getNestedString,
  getRunId,
  parseRunResult,
  sanitizeProfileForRuntime,
  toError,
} from "./messageParsing";

export { ByokRuntimeBridge, getByokRuntimeBridge, shutdownByokRuntimeBridge };

type ByokRuntimeBridgeOptions = {
  callPaperRead?: typeof callPaperRead;
};

type ByokSubprocessProcess = StdioSubprocess;
type ByokSubprocessModule = StdioSubprocessModule<ByokSubprocessProcess>;

type ActiveTurn = {
  callbacks: AgentPromptCallbacks;
  fullText: string;
  runId: string;
};

const logger = createLogger("byok.runtime");

class ByokRuntimeBridge {
  private subprocess?: ByokSubprocessModule;
  private process?: ByokSubprocessProcess;
  private transport?: StdioJsonRpcPeer;
  private activeTurns = new Map<string, ActiveTurn>();
  private startPromise?: Promise<void>;
  private initialized = false;

  constructor(private readonly options: ByokRuntimeBridgeOptions = {}) {}

  async stop(): Promise<void> {
    this.initialized = false;
    const stoppedError = new Error("BYOK runtime stopped.");
    this.rejectAll(stoppedError);
    this.transport?.stop(stoppedError);
    this.transport = undefined;
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
      workdir: getHomeDir(subprocess.getEnvironment()),
    });

    this.subprocess = subprocess;
    this.process = proc;
    this.transport = this.createTransport(proc);
    this.transport.start();

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
      this.transport?.stop(toError(error));
      this.transport = undefined;
      await proc.kill(500).catch(() => undefined);
      throw error;
    }
  }

  private async request(
    method: string,
    params?: JsonValue,
    timeoutMs = 30000,
  ): Promise<JsonValue | undefined> {
    return this.getTransport().request(method, params, timeoutMs);
  }

  private handleLine(line: string): void {
    this.getTransport().handleLine(line);
  }

  private async handleRuntimeRequest(message: JsonRpcRequest): Promise<void> {
    try {
      if (message.method !== "tool/paper_read") {
        throw new Error(`Unsupported BYOK runtime request: ${message.method}`);
      }
      const result = await (this.options.callPaperRead || callPaperRead)(
        message.params,
      );
      await this.transport?.send({ id: message.id, result });
    } catch (error) {
      await this.transport?.send({
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
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

  private rejectAll(error: Error): void {
    this.transport?.rejectAll(error);
    this.activeTurns.clear();
  }

  private getTransport(): StdioJsonRpcPeer {
    if (this.transport) {
      return this.transport;
    }
    const proc = this.process;
    if (!proc) {
      throw new Error("BYOK runtime is not running.");
    }
    this.transport = this.createTransport(proc);
    return this.transport;
  }

  private createTransport(proc: ByokSubprocessProcess): StdioJsonRpcPeer {
    return new StdioJsonRpcPeer({
      process: proc,
      requestTimeoutMessage: (method) =>
        `BYOK runtime request timed out: ${method}`,
      responseErrorFallback: "BYOK runtime error",
      exitError: (exitCode) => new Error(`BYOK runtime exited (${exitCode}).`),
      onRequest: (message) => {
        void this.handleRuntimeRequest(message);
      },
      onNotification: (message) => this.handleNotification(message),
      onInvalidJson: (line, error) => {
        logger.warn("invalid BYOK runtime JSON", {
          line,
          error: String(error),
        });
      },
      onStderrLine: (line) => {
        logger.warn("BYOK runtime stderr", { line });
      },
      onExit: () => {
        if (this.process !== proc) {
          return;
        }
        this.process = undefined;
        this.transport = undefined;
        this.initialized = false;
        this.activeTurns.clear();
      },
    });
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
