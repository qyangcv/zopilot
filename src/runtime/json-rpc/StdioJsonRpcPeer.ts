import type { JsonValue } from "../json/types";
import type { StdioSubprocess } from "../process/types";
import {
  encodeJsonRpcMessage,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./protocol";

type PendingRequest = {
  method: string;
  resolve: (result: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type StdioJsonRpcPeerOptions = {
  process: StdioSubprocess;
  requestTimeoutMessage: (method: string) => string;
  responseErrorFallback: string;
  exitError: (exitCode: number) => Error;
  onRequest?: (message: JsonRpcRequest) => void;
  onNotification?: (message: JsonRpcNotification) => void;
  onExit?: (exitCode: number) => void;
  onInvalidJson?: (line: string, error: unknown) => void;
  onStderrLine?: (line: string) => void;
};

class StdioJsonRpcPeer {
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private started = false;
  private active = true;

  constructor(private readonly options: StdioJsonRpcPeerOptions) {}

  start(): void {
    if (this.started || !this.active) {
      return;
    }
    this.started = true;
    this.readStdout();
    this.readStderr();
    this.watchExit();
  }

  async request(
    method: string,
    params?: JsonValue,
    timeoutMs: number | null = 30000,
  ): Promise<JsonValue | undefined> {
    if (!this.active) {
      throw new Error(this.options.requestTimeoutMessage(method));
    }
    const id = this.nextRequestId++;
    const promise = new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pendingRequests.delete(id);
              reject(new Error(this.options.requestTimeoutMessage(method)));
            }, timeoutMs);
      this.pendingRequests.set(id, { method, resolve, reject, timer });
    });

    try {
      await this.send({ id, method, params });
    } catch (error) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        this.pendingRequests.delete(id);
        if (pending.timer !== undefined) {
          clearTimeout(pending.timer);
        }
      }
      throw error;
    }
    return promise;
  }

  async notify(method: string, params?: JsonValue): Promise<void> {
    await this.send(params === undefined ? { method } : { method, params });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.active) {
      throw new Error("JSON-RPC peer is stopped.");
    }
    await this.options.process.stdin.write(encodeJsonRpcMessage(message));
  }

  handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcMessage(line);
    } catch (error) {
      this.options.onInvalidJson?.(line, error);
      return;
    }
    if (isJsonRpcRequest(message)) {
      this.options.onRequest?.(message);
      return;
    }
    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }
    this.options.onNotification?.(message);
  }

  stop(error: Error): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.rejectAll(error);
  }

  rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }
    this.pendingRequests.delete(message.id);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    if (message.error) {
      pending.reject(
        new Error(
          `${pending.method}: ${
            message.error.message || this.options.responseErrorFallback
          }`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private readStdout(): void {
    void (async () => {
      while (this.active) {
        const chunk = await this.options.process.stdout
          .readString()
          .catch(() => "");
        if (!chunk) {
          break;
        }
        this.stdoutBuffer += chunk;
        this.flushStdoutBuffer();
      }
    })();
  }

  private readStderr(): void {
    const stderr = this.options.process.stderr;
    if (!stderr) {
      return;
    }
    void (async () => {
      while (this.active) {
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
        this.options.onStderrLine?.(line);
      }
      newlineIndex = this.stderrBuffer.indexOf("\n");
    }
  }

  private watchExit(): void {
    void this.options.process.wait().then(({ exitCode }) => {
      if (!this.active) {
        return;
      }
      this.active = false;
      this.rejectAll(this.options.exitError(exitCode));
      this.options.onExit?.(exitCode);
    });
  }
}

export { StdioJsonRpcPeer };
export type { StdioJsonRpcPeerOptions };
