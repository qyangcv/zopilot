import { modelFromId } from "../../../domain/agent/modelCatalog";
import type {
  AgentModelEntry,
  AgentPromptInput,
  ProviderProfileWithSecret,
} from "../../../domain/agent/types";
import type { ZopilotMcpConnection } from "../../mcp/connection";
import { isRecord } from "../../../runtime/json/guards";
import type { JsonValue } from "../../../runtime/json/types";

type TurnStartParams = {
  runId: string;
  profile: ProviderProfileWithSecret;
  input: AgentPromptInput;
  mcp?: ZopilotMcpConnection;
  mcpDiagnostic?: string;
};

type ModelListParams = { profile: ProviderProfileWithSecret };

function parseModelListParams(params: JsonValue | undefined): ModelListParams {
  if (!isRecord(params) || !isRecord(params.profile)) {
    throw new Error("model/list requires a provider profile.");
  }
  return {
    profile: params.profile as unknown as ProviderProfileWithSecret,
  };
}

function parseTurnStartParams(params: JsonValue | undefined): TurnStartParams {
  if (
    !isRecord(params) ||
    !isRecord(params.profile) ||
    !isRecord(params.input)
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
    mcp: isRecord(params.mcp)
      ? (params.mcp as unknown as ZopilotMcpConnection)
      : undefined,
    mcpDiagnostic:
      typeof params.mcpDiagnostic === "string"
        ? params.mcpDiagnostic
        : undefined,
  };
}

function validateProfile(profile: ProviderProfileWithSecret): void {
  if (!profile.baseURL || !profile.apiKey) {
    throw new Error("Provider profile is incomplete.");
  }
}

function normalizeBaseURL(value: string): string {
  return value.replace(/\/+$/, "");
}

function configuredModels(
  profile: ProviderProfileWithSecret,
): AgentModelEntry[] {
  return profile.models.length ? profile.models : [];
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
      if (!id) return undefined;
      const model = modelFromId(id);
      return providerRejectsImageInput(item)
        ? { ...model, imageInputRejected: true }
        : model;
    })
    .filter((item: AgentModelEntry | undefined): item is AgentModelEntry =>
      Boolean(item),
    );
}

function providerRejectsImageInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const modalities = readStringArray(value.input_modalities);
  return Boolean(
    modalities &&
    !modalities.some((modality) => modality.toLowerCase() === "image"),
  );
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

export {
  configuredModels,
  normalizeBaseURL,
  parseModelListParams,
  parseOpenAIModelList,
  providerRejectsImageInput,
  parseTurnStartParams,
  validateProfile,
};
export type { ModelListParams, TurnStartParams };
