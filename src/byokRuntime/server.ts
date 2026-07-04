import { createInterface } from "node:readline";
import { Agent, run, tool } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  encodeJsonRpcMessage,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "../codex/jsonRpc";
import { buildCodexDeveloperInstructions } from "../codex/developerInstructions";
import type { JsonValue } from "../codex/types";
import { buildAgentPrompt } from "../agent/session/contextPolicy";
import { modelFromId } from "../agent/modelCatalog";
import type {
  AgentModelEntry,
  AgentPromptInput,
  AgentRunResult,
  ProviderProfileWithSecret,
} from "../agent/types";

type PendingRequest = {
  method: string;
  resolve: (result: JsonValue | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type TurnStartParams = {
  runId: string;
  profile: ProviderProfileWithSecret;
  input: AgentPromptInput;
};

type ModelListParams = {
  profile: ProviderProfileWithSecret;
};

type ToolCallResult = {
  text?: string;
  isError?: boolean;
};

class ByokRuntimeServer {
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly abortControllers = new Map<string, AbortController>();

  start(): void {
    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
      terminal: false,
    });
    lines.on("line", (line) => this.handleLine(line));
    lines.on("close", () => process.exit(0));
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
    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
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
        return {
          serverInfo: {
            name: "zopilot-byok-runtime",
            version: "1",
          },
        };
      case "model/list":
        return this.listModels(parseModelListParams(params));
      case "turn/start":
        return this.startTurn(parseTurnStartParams(params));
      case "turn/interrupt":
        this.interruptTurn(params);
        return {};
      default:
        throw new Error(`Unsupported BYOK runtime method: ${method}`);
    }
  }

  private async listModels(
    params: ModelListParams,
  ): Promise<AgentModelEntry[]> {
    validateProfile(params.profile);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      params.profile.timeoutMs,
    );
    try {
      const response = await fetch(
        `${normalizeBaseURL(params.profile.baseURL || "")}/models`,
        {
          headers: {
            Authorization: `Bearer ${params.profile.apiKey}`,
          },
          signal: controller.signal,
        },
      );
      if (response.status === 404 || response.status === 405) {
        return configuredModels(params.profile);
      }
      if (!response.ok) {
        throw new Error(
          `Provider model list failed: ${response.status} ${response.statusText}`,
        );
      }
      const body = (await response.json()) as unknown;
      const models = parseOpenAIModelList(body);
      return models.length ? models : configuredModels(params.profile);
    } finally {
      clearTimeout(timer);
    }
  }

  private async startTurn(params: TurnStartParams): Promise<AgentRunResult> {
    validateProfile(params.profile);
    const controller = new AbortController();
    this.abortControllers.set(params.runId, controller);
    const timer = setTimeout(
      () => controller.abort(),
      params.profile.timeoutMs,
    );
    const modelId = params.input.model || params.profile.defaultModel;
    let fullText = "";
    try {
      const provider = createOpenAICompatible({
        name: params.profile.preset,
        baseURL: normalizeBaseURL(params.profile.baseURL || ""),
        apiKey: params.profile.apiKey,
        includeUsage: params.profile.capabilities.usageMetadata,
        supportsStructuredOutputs:
          params.profile.capabilities.structuredOutput || undefined,
      });
      const model = aisdk(provider(modelId));
      const agent = new Agent({
        name: "Zopilot Research Assistant",
        instructions: buildCodexDeveloperInstructions(),
        model,
        tools: params.profile.capabilities.tools
          ? [this.createPaperReadTool(params)]
          : [],
        modelSettings: {
          parallelToolCalls: false,
          reasoning:
            params.profile.capabilities.reasoning &&
            params.input.reasoningEffort
              ? { effort: params.input.reasoningEffort as never }
              : undefined,
          retry: {
            maxRetries: params.profile.retryCount,
          },
        },
      });
      const stream = await run(
        agent,
        buildAgentPrompt({
          conversation: params.input.conversation,
          prompt: params.input.prompt,
          mentions: params.input.mentions,
          localAttachments: params.input.localAttachments,
        }),
        {
          stream: true,
          signal: controller.signal,
          maxTurns: params.profile.capabilities.tools ? 4 : 1,
        },
      );
      for await (const event of stream) {
        if (event.type === "raw_model_stream_event") {
          const data = event.data as { type?: string; delta?: string };
          if (data.type === "output_text_delta" && data.delta) {
            fullText += data.delta;
            this.notify("item/agentMessage/delta", {
              runId: params.runId,
              delta: data.delta,
            });
          }
        }
      }
      await stream.completed;
      const finalOutput =
        typeof stream.finalOutput === "string" ? stream.finalOutput : "";
      return {
        backendId: params.profile.id,
        providerProfileId: params.profile.id,
        runId: params.runId,
        text: (fullText || finalOutput).trim(),
        status: stream.cancelled ? "interrupted" : "completed",
      };
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          backendId: params.profile.id,
          providerProfileId: params.profile.id,
          runId: params.runId,
          text: fullText.trim(),
          status: "interrupted",
        };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.abortControllers.delete(params.runId);
    }
  }

  private interruptTurn(params: JsonValue | undefined): void {
    const runId =
      params && typeof params === "object" && !Array.isArray(params)
        ? params.runId
        : undefined;
    if (typeof runId === "string") {
      this.abortControllers.get(runId)?.abort();
    }
  }

  private createPaperReadTool(params: TurnStartParams) {
    return tool({
      name: "paper_read",
      description:
        "Retrieve traceable evidence from the current Zotero workspace before answering paper-specific questions.",
      parameters: z.object({
        question: z
          .string()
          .optional()
          .describe(
            "The paper-specific reading question, locator intent, section, figure, table, or page request.",
          ),
        sourceIds: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            "Optional Zopilot source IDs selected with @ mentions in the current workspace.",
          ),
      }),
      execute: async (input) => {
        this.notify("item/tool/started", {
          runId: params.runId,
          name: "paper_read",
        });
        try {
          const result = (await this.request(
            "tool/paper_read",
            {
              runId: params.runId,
              conversation: params.input.conversation
                .metadata as unknown as JsonValue,
              input: input as JsonValue,
            },
            params.profile.timeoutMs,
          )) as ToolCallResult | undefined;
          return result?.text || "";
        } finally {
          this.notify("item/tool/completed", {
            runId: params.runId,
            name: "paper_read",
          });
        }
      },
      errorFunction(_context, error) {
        const message = error instanceof Error ? error.message : String(error);
        return `paper_read failed: ${message}`;
      },
    });
  }

  private request(
    method: string,
    params?: JsonValue,
    timeoutMs = 30000,
  ): Promise<JsonValue | undefined> {
    const id = this.nextRequestId++;
    const promise = new Promise<JsonValue | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`BYOK runtime parent request timed out: ${method}`));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
        timer,
      });
    });
    this.write({ id, method, params });
    return promise;
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
          `${pending.method}: ${message.error.message || "parent error"}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
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
    process.stdout.write(encodeJsonRpcMessage(message));
  }
}

new ByokRuntimeServer().start();

function parseModelListParams(params: JsonValue | undefined): ModelListParams {
  if (!isObject(params) || !isObject(params.profile)) {
    throw new Error("model/list requires a provider profile.");
  }
  return {
    profile: params.profile as unknown as ProviderProfileWithSecret,
  };
}

function parseTurnStartParams(params: JsonValue | undefined): TurnStartParams {
  if (
    !isObject(params) ||
    !isObject(params.profile) ||
    !isObject(params.input)
  ) {
    throw new Error("turn/start requires a profile and prompt input.");
  }
  if (typeof params.runId !== "string") {
    throw new Error("turn/start requires a run id.");
  }
  return {
    runId: params.runId,
    profile: params.profile as unknown as ProviderProfileWithSecret,
    input: params.input as unknown as AgentPromptInput,
  };
}

function validateProfile(profile: ProviderProfileWithSecret): void {
  if (!profile.baseURL || !profile.defaultModel || !profile.apiKey) {
    throw new Error("Provider profile is incomplete.");
  }
}

function normalizeBaseURL(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredModels(
  profile: ProviderProfileWithSecret,
): AgentModelEntry[] {
  return profile.models.length
    ? profile.models
    : [modelFromId(profile.defaultModel)];
}

function parseOpenAIModelList(value: unknown): AgentModelEntry[] {
  const data =
    value && typeof value === "object" && Array.isArray((value as any).data)
      ? (value as any).data
      : Array.isArray(value)
        ? value
        : [];
  return data
    .map((item: unknown) => {
      const id =
        item && typeof item === "object" && typeof (item as any).id === "string"
          ? (item as any).id
          : undefined;
      return id ? modelFromId(id) : undefined;
    })
    .filter((item: AgentModelEntry | undefined): item is AgentModelEntry =>
      Boolean(item),
    );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
