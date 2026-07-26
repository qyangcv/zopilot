import {
  Agent,
  MCPServerStreamableHttp,
  connectMcpServers,
  run,
} from "@openai/agents";
import { readFile, stat } from "node:fs/promises";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isModelVisible } from "../../../domain/agent/modelCatalog";
import { buildCodexDeveloperInstructions } from "../../../application/agent/prompt/developerInstructions";
import { buildStatelessAgentPrompt } from "../../../application/agent/prompt/contextAssembler";
import {
  formatToolTraceValue,
  sanitizeToolTraceValue,
} from "../../../application/agent/toolTraceSanitizer";
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

type UnknownRecord = Record<string, unknown>;
type ByokAgentRunnerOptions = {
  notify: (method: string, params?: JsonValue) => void;
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
      const baseURL = normalizeBaseURL(params.profile.baseURL || "");
      const headers = { Authorization: `Bearer ${params.profile.apiKey}` };
      if (params.profile.providerId === "openrouter") {
        const keyResponse = await fetch(`${baseURL}/key`, {
          headers,
          signal: controller.signal,
        });
        if (!keyResponse.ok) {
          throw new Error(
            `OpenRouter API key validation failed: ${keyResponse.status} ${keyResponse.statusText}`,
          );
        }
      }
      const response = await fetch(`${baseURL}/models`, {
        headers,
        signal: controller.signal,
      });
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
    let startupTimedOut = false;
    let startupTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => {
        startupTimedOut = true;
        controller.abort();
      },
      params.profile.timeoutMs,
    );
    const markResponseStarted = () => {
      if (startupTimer === undefined) return;
      clearTimeout(startupTimer);
      startupTimer = undefined;
    };
    const modelId =
      params.input.model ||
      params.profile.defaultModel ||
      params.profile.models.find(isModelVisible)?.id;
    if (!modelId) throw new Error("No model selected for this provider.");
    const responseTexts = new Map<number, string>();
    const responsesWithTools = new Set<number>();
    const startedToolCalls = new Set<string>();
    let responseIndex = 0;
    let currentResponse = 0;
    let managedMcpServers:
      | Awaited<ReturnType<typeof connectMcpServers>>
      | undefined;
    try {
      const mcp = params.mcp
        ? new MCPServerStreamableHttp({
            url: params.mcp.url,
            name: params.mcp.serverName,
            requestInit: { headers: params.mcp.headers },
            timeout: params.mcp.timeoutMs,
            customDataExtractor: (context) => ({
              serverName: context.serverName,
              toolName: context.toolName,
              isError: context.isError === true,
              structuredContent: context.structuredContent || null,
              resultMeta: context.resultMeta || null,
            }),
          })
        : undefined;
      if (mcp && params.profile.capabilities.tools) {
        try {
          managedMcpServers = await connectMcpServers([mcp], {
            connectTimeoutMs: 10000,
            closeTimeoutMs: 5000,
            dropFailed: true,
            strict: false,
          });
          for (const error of managedMcpServers.errors.values()) {
            this.options.notify("warning", {
              runId: params.runId,
              message: `Zopilot paper tools are unavailable: ${error.message}`,
            });
          }
        } catch (error) {
          this.options.notify("warning", {
            runId: params.runId,
            message: `Zopilot paper tools are unavailable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }
      } else if (mcp && !params.profile.capabilities.tools) {
        this.options.notify("warning", {
          runId: params.runId,
          message:
            "Zopilot paper tools are unavailable because the selected provider profile does not support tools.",
        });
      } else if (params.mcpDiagnostic) {
        this.options.notify("warning", {
          runId: params.runId,
          message: `Zopilot paper tools are unavailable: ${params.mcpDiagnostic}`,
        });
      }
      const mcpAvailable = Boolean(managedMcpServers?.active.length);
      const provider = createOpenAICompatible({
        name: params.profile.providerId,
        baseURL: normalizeBaseURL(params.profile.baseURL || ""),
        apiKey: params.profile.apiKey,
        includeUsage: params.profile.capabilities.usageMetadata,
        supportsStructuredOutputs:
          params.profile.capabilities.structuredOutput || undefined,
      });
      const agent = new Agent({
        name: "Zopilot Research Assistant",
        instructions: [
          buildCodexDeveloperInstructions(),
          !mcpAvailable && (params.mcp || params.mcpDiagnostic)
            ? "Zopilot paper tools are unavailable for this turn. Do not claim that you inspected a paper or invent paper evidence; clearly tell the user when the requested answer requires those tools."
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        model: aisdk(provider(modelId)),
        mcpServers: managedMcpServers?.active || [],
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
      for (const warning of params.input.preparedLocalAttachments?.warnings ||
        []) {
        this.options.notify("warning", {
          runId: params.runId,
          message: warning,
        });
      }
      const agentInput = await buildAgentInput(params, (warning) =>
        this.options.notify("warning", {
          runId: params.runId,
          message: warning,
        }),
      );
      const stream = await run(agent, agentInput, {
        stream: true,
        signal: controller.signal,
        maxTurns: null,
      });
      for await (const event of stream) {
        markResponseStarted();
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
              startedToolCalls,
              params.mcp?.serverName,
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
            startedToolCalls,
            params.mcp?.serverName,
          );
        }
      }
      await stream.completed;
      if (startupTimedOut) {
        throw new Error(
          "Provider response timed out before streaming started.",
        );
      }
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
      if (startupTimedOut) {
        throw new Error(
          "Provider response timed out before streaming started.",
        );
      }
      if (!controller.signal.aborted) throw error;
      return {
        backendId: params.profile.id,
        providerProfileId: params.profile.id,
        runId: params.runId,
        text: ([...responseTexts.values()].at(-1) || "").trim(),
        status: "interrupted",
      };
    } finally {
      await managedMcpServers?.close().catch(() => undefined);
      if (startupTimer !== undefined) {
        clearTimeout(startupTimer);
      }
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
    startedToolCalls: Set<string>,
    serverName?: string,
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
        this.notifyToolStarted(
          runId,
          itemId,
          typeof part.toolName === "string" ? part.toolName : "tool",
          undefined,
          serverName,
          startedToolCalls,
        );
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
        this.notifyToolStarted(
          runId,
          toolCallId,
          typeof part.toolName === "string" ? part.toolName : "tool",
          argumentsText,
          serverName,
          startedToolCalls,
        );
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
    startedToolCalls: Set<string>,
    fallbackServerName?: string,
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
        typeof rawItem.namespace === "string"
          ? rawItem.namespace
          : fallbackServerName;
      const argumentsText = prettyJson(rawItem.arguments);
      this.notifyToolStarted(
        runId,
        toolCallId(rawItem),
        typeof rawItem.name === "string" ? rawItem.name : "tool",
        argumentsText,
        server,
        startedToolCalls,
      );
      return;
    }
    if (name === "tool_output") {
      const customData = asRecord(item?.customData);
      const callId = toolCallId(rawItem);
      const toolName =
        typeof customData?.toolName === "string"
          ? customData.toolName
          : typeof rawItem.name === "string"
            ? rawItem.name
            : "tool";
      const server =
        typeof customData?.serverName === "string"
          ? customData.serverName
          : fallbackServerName;
      const result = summarizeToolOutput(item?.output, customData);
      const error =
        customData?.isError === true
          ? result || `${toolName} failed`
          : undefined;
      this.options.notify("item/tool/completed", {
        runId,
        toolCallId: callId,
        kind: "mcp",
        name: toolName,
        ...(server ? { server } : {}),
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
      });
      startedToolCalls.delete(callId);
    }
  }

  private notifyToolStarted(
    runId: string,
    callId: string,
    name: string,
    argumentsText: string | undefined,
    server: string | undefined,
    startedToolCalls: Set<string>,
  ): void {
    if (startedToolCalls.has(callId)) return;
    startedToolCalls.add(callId);
    this.options.notify("item/tool/started", {
      runId,
      toolCallId: callId,
      kind: "mcp",
      name,
      ...(server ? { server } : {}),
      ...(argumentsText ? { arguments: argumentsText } : {}),
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
  try {
    if (typeof value === "string") {
      return formatToolTraceValue(JSON.parse(value));
    }
  } catch {
    // Keep ordinary text as text.
  }
  return formatToolTraceValue(value);
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (typeof record?.message === "string") return record.message;
  return prettyJson(value) || String(value);
}

function summarizeToolOutput(
  output: unknown,
  customData: UnknownRecord | undefined,
): string {
  const structured = asRecord(customData?.structuredContent);
  const imageItems = Array.isArray(structured?.images)
    ? structured.images
        .map((value) => {
          const image = asRecord(value);
          const mime =
            typeof image?.mimeType === "string" ? image.mimeType : "image";
          const page =
            typeof image?.page === "number" ? `, page ${image.page}` : "";
          return `[${mime}${page}]`;
        })
        .filter(Boolean)
    : [];
  const safeOutput = sanitizeToolTraceValue(redactImageData(output));
  const text = prettyJson(safeOutput) || "";
  return truncateText([text, ...imageItems].filter(Boolean).join("\n"), 8000);
}

function redactImageData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImageData);
  const record = asRecord(value);
  if (!record) return value;
  if (record.type === "image" || record.type === "input_image") {
    return {
      type: record.type,
      mimeType: record.mimeType,
      data: "[image omitted]",
    };
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [
      key,
      key === "data" && typeof item === "string" && item.length > 256
        ? "[large data omitted]"
        : redactImageData(item),
    ]),
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n… [truncated]`;
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

async function buildAgentInput(
  params: TurnStartParams,
  onWarning: (message: string) => void,
) {
  const prepared = params.input.preparedLocalAttachments;
  const text = [
    buildStatelessAgentPrompt({
      conversation: params.input.conversation,
      prompt: params.input.prompt,
      mentions: params.input.mentions,
      resolvedNoteContexts: params.input.resolvedNoteContexts,
    }),
    prepared?.text,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!prepared?.images.length) return text;

  const imageParts: Array<{
    type: "input_image";
    image: string;
  }> = [];
  let totalBytes = 0;
  for (const image of prepared.images.slice(0, 10)) {
    try {
      const fileStat = await stat(image.path);
      if (fileStat.size > 10 * 1024 * 1024) {
        throw new Error("image exceeds the 10 MiB limit");
      }
      if (totalBytes + fileStat.size > 30 * 1024 * 1024) {
        throw new Error("images exceed the 30 MiB per-turn limit");
      }
      const bytes = await readFile(image.path);
      const actualMimeType = detectImageMimeType(bytes);
      if (actualMimeType !== image.mimeType) {
        throw new Error(
          actualMimeType
            ? `file content is ${actualMimeType}, not ${image.mimeType}`
            : "file content is not a supported PNG, JPEG, WebP, or GIF image",
        );
      }
      totalBytes += bytes.byteLength;
      imageParts.push({
        type: "input_image",
        image: `data:${image.mimeType};base64,${bytes.toString("base64")}`,
      });
    } catch (error) {
      onWarning(
        `Could not read image attachment ${image.filename}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (!imageParts.length && !prepared.text) {
    throw new Error("No selected image attachment could be read.");
  }
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text,
        },
        ...imageParts,
      ],
    },
  ];
}

function detectImageMimeType(
  bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const header = bytes.subarray(0, 12);
  const ascii = String.fromCharCode(...header);
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") {
    return "image/webp";
  }
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) {
    return "image/gif";
  }
  return undefined;
}

export { ByokAgentRunner, buildAgentInput, detectImageMimeType };
export type { ByokAgentRunnerOptions };
