import { Agent, run, tool } from "@openai/agents";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { buildCodexDeveloperInstructions } from "../../../application/agent/prompt/developerInstructions";
import { buildStatelessAgentPrompt } from "../../../application/agent/prompt/contextAssembler";
import type {
  AgentModelEntry,
  AgentRunResult,
} from "../../../domain/agent/types";
import type { JsonValue } from "../../../runtime/json/types";
import {
  configuredModels,
  normalizeBaseURL,
  parseOpenAIModelList,
  validateProfile,
  type ModelListParams,
  type TurnStartParams,
} from "./requestValidation";

type ToolCallResult = { text?: string; isError?: boolean };
type UnknownRecord = Record<string, unknown>;
type ByokAgentRunnerOptions = {
  notify: (method: string, params?: JsonValue) => void;
  requestParent: (
    method: string,
    params?: JsonValue,
    timeoutMs?: number,
  ) => Promise<JsonValue | undefined>;
};

class ByokAgentRunner {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly options: ByokAgentRunnerOptions) {}

  async listModels(params: ModelListParams): Promise<AgentModelEntry[]> {
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
          headers: { Authorization: `Bearer ${params.profile.apiKey}` },
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
      const models = parseOpenAIModelList(await response.json());
      return models.length ? models : configuredModels(params.profile);
    } finally {
      clearTimeout(timer);
    }
  }

  async startTurn(params: TurnStartParams): Promise<AgentRunResult> {
    validateProfile(params.profile);
    const controller = new AbortController();
    this.abortControllers.set(params.runId, controller);
    const timer = setTimeout(
      () => controller.abort(),
      params.profile.timeoutMs,
    );
    const modelId =
      params.input.model ||
      params.profile.models[0]?.id ||
      params.profile.defaultModel;
    if (!modelId) throw new Error("No model selected for this provider.");
    const responseTexts = new Map<number, string>();
    const responsesWithTools = new Set<number>();
    let responseIndex = 0;
    let currentResponse = 0;
    try {
      const provider = createOpenAICompatible({
        name: params.profile.preset,
        baseURL: normalizeBaseURL(params.profile.baseURL || ""),
        apiKey: params.profile.apiKey,
        includeUsage: params.profile.capabilities.usageMetadata,
        supportsStructuredOutputs:
          params.profile.capabilities.structuredOutput || undefined,
      });
      const agent = new Agent({
        name: "Zopilot Research Assistant",
        instructions: buildCodexDeveloperInstructions(),
        model: aisdk(provider(modelId)),
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
          retry: { maxRetries: params.profile.retryCount },
        },
      });
      const stream = await run(
        agent,
        buildStatelessAgentPrompt({
          conversation: params.input.conversation,
          prompt: params.input.prompt,
          mentions: params.input.mentions,
          localAttachments: params.input.localAttachments,
        }),
        { stream: true, signal: controller.signal, maxTurns: null },
      );
      for await (const event of stream) {
        if (event.type === "raw_model_stream_event") {
          const data = asRecord(event.data);
          if (data?.type === "response_started") {
            currentResponse = ++responseIndex;
            responseTexts.set(currentResponse, "");
            continue;
          }
          if (data?.type === "output_text_delta" && data.delta) {
            if (!currentResponse) {
              currentResponse = ++responseIndex;
            }
            const delta = String(data.delta);
            responseTexts.set(
              currentResponse,
              `${responseTexts.get(currentResponse) || ""}${delta}`,
            );
            this.options.notify("item/agentMessage/delta", {
              runId: params.runId,
              itemId: `response-${currentResponse}-message`,
              phase: "candidate",
              delta,
            });
            continue;
          }
          if (data?.type === "model") {
            if (!currentResponse) {
              currentResponse = ++responseIndex;
              responseTexts.set(currentResponse, "");
            }
            this.handleModelPart(
              params.runId,
              currentResponse,
              data.event,
              responsesWithTools,
            );
          }
          continue;
        }
        if (event.type === "run_item_stream_event") {
          this.handleRunItem(
            params.runId,
            currentResponse || responseIndex || 1,
            event.name,
            event.item,
          );
        }
      }
      await stream.completed;
      const finalOutput =
        typeof stream.finalOutput === "string" ? stream.finalOutput : "";
      const lastVisibleResponse = [...responseTexts.entries()]
        .reverse()
        .find(([index, text]) => text && !responsesWithTools.has(index))?.[1];
      return {
        backendId: params.profile.id,
        providerProfileId: params.profile.id,
        runId: params.runId,
        text: (finalOutput || lastVisibleResponse || "").trim(),
        status: stream.cancelled ? "interrupted" : "completed",
      };
    } catch (error) {
      if (!controller.signal.aborted) throw error;
      return {
        backendId: params.profile.id,
        providerProfileId: params.profile.id,
        runId: params.runId,
        text: ([...responseTexts.values()].at(-1) || "").trim(),
        status: "interrupted",
      };
    } finally {
      clearTimeout(timer);
      this.abortControllers.delete(params.runId);
    }
  }

  interrupt(runId: string): void {
    this.abortControllers.get(runId)?.abort();
  }

  private handleModelPart(
    runId: string,
    responseIndex: number,
    value: unknown,
    responsesWithTools: Set<number>,
  ): void {
    const part = asRecord(value);
    if (!part || typeof part.type !== "string") return;
    const rawItemId = typeof part.id === "string" ? part.id : part.type;
    const itemId = part.type.startsWith("reasoning-")
      ? `response-${responseIndex}-${rawItemId}`
      : rawItemId;
    switch (part.type) {
      case "reasoning-delta":
        if (typeof part.delta === "string") {
          this.options.notify("item/reasoning/delta", {
            runId,
            itemId,
            kind: "content",
            delta: part.delta,
          });
        }
        break;
      case "tool-input-start":
        responsesWithTools.add(responseIndex);
        this.options.notify("item/tool/started", {
          runId,
          toolCallId: itemId,
          name: typeof part.toolName === "string" ? part.toolName : "tool",
        });
        break;
      case "tool-input-delta":
        if (typeof part.delta === "string") {
          this.options.notify("item/tool/argumentsDelta", {
            runId,
            toolCallId: itemId,
            delta: part.delta,
          });
        }
        break;
      case "tool-call": {
        responsesWithTools.add(responseIndex);
        const toolCallId =
          typeof part.toolCallId === "string" ? part.toolCallId : itemId;
        const argumentsText = prettyJson(part.input);
        this.options.notify("item/tool/started", {
          runId,
          toolCallId,
          name: typeof part.toolName === "string" ? part.toolName : "tool",
          ...(argumentsText ? { arguments: argumentsText } : {}),
        });
        break;
      }
      case "stream-start":
        if (Array.isArray(part.warnings)) {
          for (const warning of part.warnings) {
            this.options.notify("warning", {
              runId,
              message: formatUnknown(warning),
            });
          }
        }
        break;
      default:
        break;
    }
  }

  private handleRunItem(
    runId: string,
    responseIndex: number,
    name: string,
    value: unknown,
  ): void {
    const item = asRecord(value);
    const rawItem = asRecord(item?.rawItem);
    if (!rawItem) return;
    if (name === "message_output_created") {
      const text = extractTextParts(rawItem.content);
      if (text) {
        this.options.notify("item/agentMessage/completed", {
          runId,
          itemId: `response-${responseIndex}-message`,
          phase: "candidate",
          text,
        });
      }
      return;
    }
    if (name === "reasoning_item_created") {
      const text = extractTextParts(rawItem.rawContent || rawItem.content);
      if (text) {
        const rawId = typeof rawItem.id === "string" ? rawItem.id : "reasoning";
        this.options.notify("item/reasoning/completed", {
          runId,
          itemId: `response-${responseIndex}-${rawId}`,
          kind: "content",
          text,
        });
      }
      return;
    }
    if (name === "tool_called") {
      const server =
        typeof rawItem.namespace === "string" ? rawItem.namespace : undefined;
      const argumentsText = prettyJson(rawItem.arguments);
      this.options.notify("item/tool/started", {
        runId,
        toolCallId: toolCallId(rawItem),
        name: typeof rawItem.name === "string" ? rawItem.name : "tool",
        ...(server ? { server } : {}),
        ...(argumentsText ? { arguments: argumentsText } : {}),
      });
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
            "The paper-specific reading question or natural-language information need.",
          ),
        sourceIds: z
          .array(z.string())
          .max(5)
          .optional()
          .describe(
            "Optional Zopilot source IDs selected with @ mentions in the current workspace.",
          ),
      }),
      execute: async (input, _context, details) => {
        const callId = toolCallId(asRecord(details?.toolCall));
        const argumentsText = prettyJson(input);
        this.options.notify("item/tool/started", {
          runId: params.runId,
          toolCallId: callId,
          name: "paper_read",
          server: "zopilot",
          ...(argumentsText ? { arguments: argumentsText } : {}),
        });
        try {
          const result = (await this.options.requestParent(
            "tool/paper_read",
            {
              runId: params.runId,
              conversation: params.input.conversation
                .metadata as unknown as JsonValue,
              input: input as JsonValue,
            },
            params.profile.timeoutMs,
          )) as ToolCallResult | undefined;
          const errorText = result?.isError
            ? result.text || "paper_read failed"
            : undefined;
          this.options.notify("item/tool/completed", {
            runId: params.runId,
            toolCallId: callId,
            name: "paper_read",
            server: "zopilot",
            ...(argumentsText ? { arguments: argumentsText } : {}),
            result: result?.text || "",
            ...(errorText ? { error: errorText } : {}),
          });
          return result?.text || "";
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.options.notify("item/tool/completed", {
            runId: params.runId,
            toolCallId: callId,
            name: "paper_read",
            server: "zopilot",
            ...(argumentsText ? { arguments: argumentsText } : {}),
            error: message,
          });
          throw error;
        }
      },
      errorFunction(_context, error) {
        const message = error instanceof Error ? error.message : String(error);
        return `paper_read failed: ${message}`;
      },
    });
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function toolCallId(value: UnknownRecord | undefined): string {
  if (typeof value?.callId === "string") return value.callId;
  if (typeof value?.id === "string") return value.id;
  return `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function prettyJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (typeof record?.message === "string") return record.message;
  return prettyJson(value) || String(value);
}

function extractTextParts(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map(extractTextParts).filter(Boolean).join("\n\n");
  }
  const record = asRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  return "";
}

export { ByokAgentRunner };
export type { ByokAgentRunnerOptions };
