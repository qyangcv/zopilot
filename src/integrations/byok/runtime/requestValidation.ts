import { modelFromId } from "../../../domain/agent/modelCatalog";
import type {
  AgentModelEntry,
  AgentPromptInput,
  ProviderProfileWithSecret,
} from "../../../domain/agent/types";
import { isRecord } from "../../../runtime/json/guards";
import type { JsonValue } from "../../../runtime/json/types";

type TurnStartParams = {
  runId: string;
  profile: ProviderProfileWithSecret;
  input: AgentPromptInput;
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
      return id ? modelFromId(id) : undefined;
    })
    .filter((item: AgentModelEntry | undefined): item is AgentModelEntry =>
      Boolean(item),
    );
}

export {
  configuredModels,
  normalizeBaseURL,
  parseModelListParams,
  parseOpenAIModelList,
  parseTurnStartParams,
  validateProfile,
};
export type { ModelListParams, TurnStartParams };
