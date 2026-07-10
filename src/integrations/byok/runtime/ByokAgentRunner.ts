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
        if (event.type !== "raw_model_stream_event") continue;
        const data = event.data as { type?: string; delta?: string };
        if (data.type === "output_text_delta" && data.delta) {
          fullText += data.delta;
          this.options.notify("item/agentMessage/delta", {
            runId: params.runId,
            delta: data.delta,
          });
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
      if (!controller.signal.aborted) throw error;
      return {
        backendId: params.profile.id,
        providerProfileId: params.profile.id,
        runId: params.runId,
        text: fullText.trim(),
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
        this.options.notify("item/tool/started", {
          runId: params.runId,
          name: "paper_read",
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
          return result?.text || "";
        } finally {
          this.options.notify("item/tool/completed", {
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
}

export { ByokAgentRunner };
export type { ByokAgentRunnerOptions };
