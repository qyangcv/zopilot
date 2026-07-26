import { createInterface } from "node:readline";
import {
  encodeJsonRpcMessage,
  isJsonRpcRequest,
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from "../../../runtime/json-rpc/protocol";
import type { JsonValue } from "../../../runtime/json/types";
import { ByokAgentRunner } from "./ByokAgentRunner";
import {
  parseModelListParams,
  parseTurnStartParams,
} from "./requestValidation";

type ByokRuntimeServerIO = {
  write(line: string): void;
  exit(code: number): void;
};

class ByokRuntimeServer {
  private readonly agentRunner: ByokAgentRunner;

  constructor(
    private readonly io: ByokRuntimeServerIO = {
      write: (line) => process.stdout.write(line),
      exit: (code) => process.exit(code),
    },
  ) {
    this.agentRunner = new ByokAgentRunner({
      notify: (method, params) => this.notify(method, params),
    });
  }

  start(): void {
    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });
    lines.on("line", (line) => this.handleLine(line));
    lines.on("close", () => this.io.exit(0));
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = parseJsonRpcMessage(line);
    } catch (error) {
      this.notify("warning", {
        message: `Invalid BYOK runtime JSON: ${String(error)}`,
      });
      return;
    }
    if (isJsonRpcRequest(message)) {
      void this.handleRequest(message);
    }
  }

  private async handleRequest(message: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.dispatchRequest(message.method, message.params);
      this.respond(message.id, { result });
    } catch (error) {
      this.respond(message.id, {
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async dispatchRequest(
    method: string,
    params: JsonValue | undefined,
  ): Promise<JsonValue | undefined> {
    switch (method) {
      case "initialize":
        return { serverInfo: { name: "zopilot-byok-runtime", version: "1" } };
      case "model/list":
        return this.agentRunner.listModels(parseModelListParams(params));
      case "turn/start":
        return this.agentRunner.startTurn(parseTurnStartParams(params));
      case "turn/interrupt": {
        const runId = readRunId(params);
        if (runId) this.agentRunner.interrupt(runId);
        return {};
      }
      default:
        throw new Error(`Unsupported BYOK runtime method: ${method}`);
    }
  }

  private respond(
    id: number,
    payload:
      | { result: JsonValue | undefined }
      | { error: { code: number; message: string } },
  ): void {
    this.write({ id, ...payload });
  }

  private notify(method: string, params?: JsonValue): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  private write(message: JsonRpcMessage): void {
    this.io.write(encodeJsonRpcMessage(message));
  }
}

function readRunId(params: JsonValue | undefined): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  return typeof params.runId === "string" ? params.runId : undefined;
}

export { ByokRuntimeServer };
export type { ByokRuntimeServerIO };
