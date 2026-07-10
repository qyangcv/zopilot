import { config, version } from "../../../package.json";
import { buildCodexAppServerArguments } from "./appServerConfig";
import {
  buildCodexSubprocessEnvironment,
  resolveCodexBinaryPath,
} from "./cliDiscovery";
import type { JsonRpcRequest } from "../../runtime/json-rpc/protocol";
import type {
  CodexModelInfo,
  CodexPromptOptions,
  CodexPromptResult,
} from "./types";
import type { JsonValue } from "../../runtime/json/types";
import { parseModelList, toError } from "./messageParsing";
import { getPref } from "../../runtime/preferences/prefs";
import { createLogger } from "../../runtime/logging/logger";
import { getHomeDir } from "../../runtime/platform/host";
import { StdioJsonRpcPeer } from "../../runtime/json-rpc/StdioJsonRpcPeer";
import type {
  StdioSubprocess,
  StdioSubprocessModule,
} from "../../runtime/process/types";
import { CodexTurnRegistry, type ActiveCodexTurn } from "./CodexTurnRegistry";
import { CodexThreadManager } from "./CodexThreadManager";

type CodexSubprocessProcess = StdioSubprocess;
type CodexSubprocessModule = StdioSubprocessModule<CodexSubprocessProcess>;

export { CodexBridge, getCodexBridge, shutdownCodexBridge };

const logger = createLogger("codex.bridge");

class CodexBridge {
  private subprocess?: CodexSubprocessModule;
  private process?: CodexSubprocessProcess;
  private transport?: StdioJsonRpcPeer;
  private startPromise?: Promise<void>;
  private readonly threads = new CodexThreadManager({
    start: () => this.start(),
    request: (method, params) => this.request(method, params),
    getCwd: () =>
      this.subprocess
        ? getHomeDir(this.subprocess.getEnvironment())
        : undefined,
  });
  private initialized = false;
  private readonly activeTurns = new CodexTurnRegistry();

  async start(): Promise<void> {
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

  async stop(): Promise<void> {
    this.initialized = false;
    this.threads.clear();
    const stoppedError = new Error("Codex app-server stopped.");
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

  async sendPrompt(
    prompt: string,
    options: CodexPromptOptions,
  ): Promise<CodexPromptResult> {
    const threadId = await this.threads.ensure(options.conversation);

    const turnPromise = new Promise<CodexPromptResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.activeTurns.remove(threadId);
        reject(new Error("Codex request timed out."));
      }, this.getTimeoutMs());
      const activeTurn: ActiveCodexTurn = {
        fullText: "",
        resolve,
        reject,
        onDelta: options.onDelta,
        onNotice: options.onNotice,
        onToolActivity: options.onToolActivity,
        onTurnStarted: options.onTurnStarted,
        timer,
        threadId,
      };
      this.activeTurns.add(activeTurn);
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
      const cwd = this.subprocess
        ? getHomeDir(this.subprocess.getEnvironment())
        : undefined;
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
      const activeTurn = this.activeTurns.find(threadId);
      if (activeTurn && result?.turn?.id) {
        this.activeTurns.assignTurnId(activeTurn, result.turn.id);
      }
      return turnPromise;
    } catch (error) {
      this.activeTurns.reject(threadId, undefined, error);
      throw error;
    }
  }

  private async startProcess(): Promise<void> {
    const subprocess = this.getSubprocess();
    const environment = await buildCodexSubprocessEnvironment(subprocess);
    const command = await resolveCodexBinaryPath(environment.PATH);
    const proc = await subprocess.call({
      command: command.command,
      arguments: [...command.argsPrefix, ...buildCodexAppServerArguments()],
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
        capabilities: {
          experimentalApi: true,
        },
      });
      await this.notify("initialized");
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

  private async notify(method: string, params?: JsonValue): Promise<void> {
    await this.getTransport().notify(method, params);
  }

  private handleLine(line: string): void {
    this.getTransport().handleLine(line);
  }

  private rejectServerRequest(message: JsonRpcRequest): void {
    const method = message.method || "unknown";
    const response = {
      id: message.id,
      error: {
        code: -32601,
        message: `Zopilot does not support app-server request: ${method}`,
      },
    };
    void this.transport?.send(response);
  }

  private rejectAll(error: Error): void {
    this.transport?.rejectAll(error);
    this.activeTurns.rejectAll(error);
  }

  private getTransport(): StdioJsonRpcPeer {
    if (this.transport) {
      return this.transport;
    }
    const proc = this.process;
    if (!proc) {
      throw new Error("Codex app-server is not running.");
    }
    this.transport = this.createTransport(proc);
    return this.transport;
  }

  private createTransport(proc: CodexSubprocessProcess): StdioJsonRpcPeer {
    return new StdioJsonRpcPeer({
      process: proc,
      requestTimeoutMessage: (method) => `Codex request timed out: ${method}`,
      responseErrorFallback: "Codex error",
      exitError: (exitCode) =>
        new Error(`Codex app-server exited (${exitCode}).`),
      onRequest: (message) => this.rejectServerRequest(message),
      onNotification: (message) => this.activeTurns.handleNotification(message),
      onInvalidJson: (line, error) => {
        logger.warn("invalid codex app-server JSON", {
          line,
          error: String(error),
        });
      },
      onStderrLine: (line) => {
        logger.warn("codex app-server stderr", { line });
      },
      onExit: (exitCode) => {
        if (this.process !== proc) {
          return;
        }
        this.process = undefined;
        this.transport = undefined;
        this.initialized = false;
        this.threads.clear();
        this.activeTurns.rejectAll(
          new Error(`Codex app-server exited (${exitCode}).`),
        );
      },
    });
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
