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
import type {
  AgentContentPhase,
  AgentReasoningKind,
} from "../../domain/agent/trace";
import type {
  AgentStreamEvent,
  AgentStreamEventInput,
} from "../../domain/agent/streaming";
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
import { loadSubprocessModule } from "../../platform/gecko";

export { ByokRuntimeBridge, getByokRuntimeBridge, shutdownByokRuntimeBridge };

type ByokRuntimeBridgeOptions = {
  callPaperRead?: typeof callPaperRead;
};

type ByokSubprocessProcess = StdioSubprocess;
type ByokSubprocessModule = StdioSubprocessModule<ByokSubprocessProcess>;

type ActiveTurn = {
  anonymousBlockIds: Map<string, string>;
  callbacks: AgentPromptCallbacks;
  eventSequence: number;
  runId: string;
  streamLengths: Map<string, number>;
  syntheticIdSequence: number;
};

const logger = createLogger("byok.runtime");

class ByokRuntimeBridge {
  private subprocess?: ByokSubprocessModule;
  private process?: ByokSubprocessProcess;
  private transport?: StdioJsonRpcPeer;
  private activeTurns = new Map<string, ActiveTurn>();
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private stopping = false;
  private initialized = false;

  constructor(private readonly options: ByokRuntimeBridgeOptions = {}) {}

  stop(): Promise<void> {
    this.stopPromise ??= this.stopProcess();
    return this.stopPromise;
  }

  private async stopProcess(): Promise<void> {
    this.stopping = true;
    this.initialized = false;
    const stoppedError = new Error("BYOK runtime stopped.");
    this.rejectAll(stoppedError);
    this.stopTransport(stoppedError);
    await this.startPromise?.catch(() => undefined);
    this.initialized = false;
    this.rejectAll(stoppedError);
    this.stopTransport(stoppedError);
    const proc = this.process;
    this.process = undefined;
    if (!proc) {
      return;
    }
    await proc.stdin.close().catch(() => undefined);
    await proc.kill(500).catch(() => undefined);
  }

  private stopTransport(error: Error): void {
    this.transport?.stop(error);
    this.transport = undefined;
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
    const activeTurn: ActiveTurn = {
      anonymousBlockIds: new Map(),
      callbacks,
      eventSequence: 0,
      runId,
      streamLengths: new Map(),
      syntheticIdSequence: 0,
    };
    this.activeTurns.set(runId, activeTurn);
    this.emit(activeTurn, {
      type: "turn.started",
      backendId: profile.id,
      providerProfileId: profile.id,
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
        null,
      );
      const parsed = parseRunResult(result, profile, runId);
      this.emit(activeTurn, {
        type:
          parsed.status === "interrupted"
            ? "turn.interrupted"
            : "turn.completed",
        text: parsed.text,
      });
      return parsed;
    } catch (error) {
      this.emit(activeTurn, {
        type: "turn.failed",
        error: toError(error).message,
      });
      throw error;
    } finally {
      this.activeTurns.delete(runId);
    }
  }

  async interruptTurn(runId: string): Promise<void> {
    await this.start();
    await this.request("turn/interrupt", { runId }, 10000);
  }

  private async start(): Promise<void> {
    if (this.stopping) {
      throw new Error("BYOK runtime is stopping.");
    }
    if (this.initialized && this.process) {
      return;
    }
    if (this.startPromise) {
      await this.startPromise;
      if (this.stopping) {
        throw new Error("BYOK runtime is stopping.");
      }
      return;
    }
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
    if (this.stopping) {
      throw new Error("BYOK runtime is stopping.");
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
    timeoutMs: number | null = 30000,
  ): Promise<JsonValue | undefined> {
    return this.getTransport().request(method, params, timeoutMs);
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
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "agent-message",
          );
          const streamKey = contentStreamKey(blockId);
          const expectedOffset = this.getStreamLength(activeTurn, streamKey);
          this.setStreamLength(
            activeTurn,
            streamKey,
            expectedOffset + delta.length,
          );
          this.emit(activeTurn, {
            type: "content.append",
            blockId,
            phase: parseContentPhase(
              getNestedString(message.params, ["phase"]),
            ),
            expectedOffset,
            delta,
          });
        }
        break;
      }
      case "item/agentMessage/completed": {
        const text = getNestedString(message.params, ["text"]);
        if (activeTurn && text !== undefined) {
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "agent-message",
          );
          this.setStreamLength(
            activeTurn,
            contentStreamKey(blockId),
            text.length,
          );
          this.emit(activeTurn, {
            type: "content.replace",
            blockId,
            phase: parseContentPhase(
              getNestedString(message.params, ["phase"]),
            ),
            text,
          });
          activeTurn.anonymousBlockIds.delete("agent-message");
        }
        break;
      }
      case "item/reasoning/delta": {
        const delta = getNestedString(message.params, ["delta"]);
        if (activeTurn && delta) {
          const kind = parseReasoningKind(
            getNestedString(message.params, ["kind"]),
          );
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            `reasoning:${kind}`,
          );
          const streamKey = reasoningStreamKey(blockId);
          const expectedOffset = this.getStreamLength(activeTurn, streamKey);
          this.setStreamLength(
            activeTurn,
            streamKey,
            expectedOffset + delta.length,
          );
          this.emit(activeTurn, {
            type: "reasoning.append",
            blockId,
            kind,
            expectedOffset,
            delta,
          });
        }
        break;
      }
      case "item/reasoning/completed": {
        const text = getNestedString(message.params, ["text"]);
        if (activeTurn && text !== undefined) {
          const kind = parseReasoningKind(
            getNestedString(message.params, ["kind"]),
          );
          const channel = `reasoning:${kind}`;
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            channel,
          );
          this.setStreamLength(
            activeTurn,
            reasoningStreamKey(blockId),
            text.length,
          );
          this.emit(activeTurn, {
            type: "reasoning.replace",
            blockId,
            kind,
            text,
          });
          activeTurn.anonymousBlockIds.delete(channel);
        }
        break;
      }
      case "item/tool/started": {
        const name = getNestedString(message.params, ["name"]) || "tool";
        if (activeTurn) {
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "tool",
            true,
          );
          const argumentsText = getNestedString(message.params, ["arguments"]);
          if (argumentsText) {
            this.setStreamLength(
              activeTurn,
              toolArgumentsStreamKey(blockId),
              argumentsText.length,
            );
          }
          this.emit(activeTurn, {
            type: "tool.started",
            blockId,
            name,
            server: getNestedString(message.params, ["server"]),
            arguments: argumentsText,
          });
        }
        break;
      }
      case "item/tool/argumentsDelta": {
        const delta = getNestedString(message.params, ["delta"]);
        if (activeTurn && delta) {
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "tool",
            true,
          );
          const streamKey = toolArgumentsStreamKey(blockId);
          const expectedOffset = this.getStreamLength(activeTurn, streamKey);
          this.setStreamLength(
            activeTurn,
            streamKey,
            expectedOffset + delta.length,
          );
          this.emit(activeTurn, {
            type: "tool.arguments.append",
            blockId,
            expectedOffset,
            delta,
          });
        }
        break;
      }
      case "item/tool/progress": {
        const delta = getNestedString(message.params, ["delta"]);
        if (activeTurn && delta) {
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "tool",
            true,
          );
          const streamKey = toolProgressStreamKey(blockId);
          const expectedOffset = this.getStreamLength(activeTurn, streamKey);
          this.setStreamLength(
            activeTurn,
            streamKey,
            expectedOffset + delta.length,
          );
          this.emit(activeTurn, {
            type: "tool.progress.append",
            blockId,
            expectedOffset,
            delta,
          });
        }
        break;
      }
      case "item/tool/completed": {
        const name = getNestedString(message.params, ["name"]) || "tool";
        if (activeTurn) {
          const blockId = this.getStableBlockId(
            activeTurn,
            message.params,
            "tool",
            true,
          );
          this.emit(activeTurn, {
            type: "tool.completed",
            blockId,
            name,
            server: getNestedString(message.params, ["server"]),
            arguments: getNestedString(message.params, ["arguments"]),
            result: getNestedString(message.params, ["result"]),
            error: getNestedString(message.params, ["error"]),
          });
          activeTurn.anonymousBlockIds.delete("tool");
        }
        break;
      }
      case "warning": {
        const warning = getNestedString(message.params, ["message"]);
        if (warning) {
          if (activeTurn) {
            this.emit(activeTurn, {
              type: "notice.upsert",
              blockId: this.nextSyntheticId(activeTurn, "warning"),
              text: warning,
            });
          }
          logger.warn("BYOK runtime warning", { warning, runId });
        }
        break;
      }
      default:
        break;
    }
  }

  private emit(activeTurn: ActiveTurn, event: AgentStreamEventInput): void {
    activeTurn.eventSequence += 1;
    activeTurn.callbacks.onEvent?.({
      ...event,
      sequence: activeTurn.eventSequence,
    } as AgentStreamEvent);
  }

  private getStreamLength(activeTurn: ActiveTurn, key: string): number {
    return activeTurn.streamLengths.get(key) || 0;
  }

  private setStreamLength(
    activeTurn: ActiveTurn,
    key: string,
    length: number,
  ): void {
    activeTurn.streamLengths.set(key, length);
  }

  private nextSyntheticId(activeTurn: ActiveTurn, prefix: string): string {
    activeTurn.syntheticIdSequence += 1;
    return `${prefix}-${activeTurn.syntheticIdSequence}`;
  }

  private getStableBlockId(
    activeTurn: ActiveTurn,
    params: JsonValue | undefined,
    channel: string,
    tool = false,
  ): string {
    const explicit =
      (tool ? getNestedString(params, ["toolCallId"]) : undefined) ||
      getNestedString(params, ["itemId"]);
    if (explicit) {
      activeTurn.anonymousBlockIds.set(channel, explicit);
      return explicit;
    }
    const current = activeTurn.anonymousBlockIds.get(channel);
    if (current) return current;
    const generated = this.nextSyntheticId(activeTurn, channel);
    activeTurn.anonymousBlockIds.set(channel, generated);
    return generated;
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
    this.subprocess = loadSubprocessModule<ByokSubprocessModule>();
    return this.subprocess;
  }
}

function parseContentPhase(value: string | undefined): AgentContentPhase {
  return value === "commentary" || value === "final_answer"
    ? value
    : "candidate";
}

function parseReasoningKind(value: string | undefined): AgentReasoningKind {
  return value === "summary" ? "summary" : "content";
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

let sharedBridge: ByokRuntimeBridge | undefined;
let bridgeShutdownPromise: Promise<void> | undefined;

function getByokRuntimeBridge(): ByokRuntimeBridge {
  if (bridgeShutdownPromise) {
    throw new Error("BYOK runtime is shutting down.");
  }
  sharedBridge ??= new ByokRuntimeBridge();
  return sharedBridge;
}

function shutdownByokRuntimeBridge(): Promise<void> {
  if (bridgeShutdownPromise) return bridgeShutdownPromise;
  const bridge = sharedBridge;
  sharedBridge = undefined;
  const pending = bridge?.stop() || Promise.resolve();
  bridgeShutdownPromise = pending;
  pending.then(
    () => {
      if (bridgeShutdownPromise === pending) {
        bridgeShutdownPromise = undefined;
      }
    },
    () => {
      if (bridgeShutdownPromise === pending) {
        bridgeShutdownPromise = undefined;
      }
    },
  );
  return pending;
}
