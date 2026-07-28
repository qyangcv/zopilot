import { modelFromId } from "../../../domain/agent/modelCatalog";
import type {
  AgentModelEntry,
  AgentPromptInput,
  DiscoveredAgentModel,
  DiscoveredModelPricing,
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

function parseOpenAIModelList(value: unknown): DiscoveredAgentModel[] {
  return parseModelList(value, parseOpenAIModel);
}

function parseOpenRouterModelList(value: unknown): DiscoveredAgentModel[] {
  return parseModelList(value, parseOpenRouterModel);
}

function parseModelList(
  value: unknown,
  parseModel: (
    value: unknown,
    catalogOrder: number,
  ) => DiscoveredAgentModel | undefined,
): DiscoveredAgentModel[] {
  const data = readModelListData(value);
  return data
    .map(parseModel)
    .filter(
      (item: DiscoveredAgentModel | undefined): item is DiscoveredAgentModel =>
        Boolean(item),
    );
}

function readModelListData(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return isRecord(value) && Array.isArray(value.data) ? value.data : [];
}

function parseOpenAIModel(
  value: unknown,
  catalogOrder: number,
): DiscoveredAgentModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  const inputModalities = readStringArray(value.input_modalities) || [];
  return createDiscoveredModel({
    catalogOrder,
    id,
    inputModalities,
    name: readString(value.name),
    outputModalities: readStringArray(value.output_modalities) || [],
    rejectsImages: providerRejectsImageInput(value),
    supportedParameters: readStringArray(value.supported_parameters) || [],
  });
}

function parseOpenRouterModel(
  value: unknown,
  catalogOrder: number,
): DiscoveredAgentModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = readString(value.id);
  if (!id) return undefined;
  const architecture = isRecord(value.architecture)
    ? value.architecture
    : undefined;
  const reasoning = isRecord(value.reasoning) ? value.reasoning : undefined;
  const inputModalities = readStringArray(architecture?.input_modalities) || [];
  const supportedParameters = readStringArray(value.supported_parameters) || [];
  const supportedReasoningEfforts =
    readStringArray(reasoning?.supported_efforts) ||
    (supportedParameters.includes("reasoning")
      ? ["low", "medium", "high"]
      : []);
  return createDiscoveredModel({
    authorSlug: readAuthorSlug(id),
    catalogOrder,
    contextLength: readNumber(value.context_length),
    createdAt: readNumber(value.created),
    defaultReasoningEffort: readString(reasoning?.default_effort),
    expirationDate: readString(value.expiration_date),
    id,
    inputModalities,
    name: readString(value.name),
    outputModalities: readStringArray(architecture?.output_modalities) || [],
    pricing: readPricing(value.pricing),
    rejectsImages: Boolean(
      inputModalities.length && !inputModalities.includes("image"),
    ),
    supportedParameters,
    supportedReasoningEfforts,
  });
}

function createDiscoveredModel(input: {
  authorSlug?: string;
  catalogOrder: number;
  contextLength?: number;
  createdAt?: number;
  defaultReasoningEffort?: string;
  expirationDate?: string;
  id: string;
  inputModalities: string[];
  name?: string;
  outputModalities: string[];
  pricing?: DiscoveredModelPricing;
  rejectsImages: boolean;
  supportedParameters: string[];
  supportedReasoningEfforts?: string[];
}): DiscoveredAgentModel {
  const base = modelFromId(input.id);
  const supportedReasoningEfforts =
    input.supportedReasoningEfforts ?? base.supportedReasoningEfforts;
  const preferredReasoningEffort =
    input.defaultReasoningEffort || base.defaultReasoningEffort;
  const defaultReasoningEffort = supportedReasoningEfforts.includes(
    preferredReasoningEffort || "",
  )
    ? preferredReasoningEffort
    : supportedReasoningEfforts[0];
  return {
    ...base,
    authorSlug: input.authorSlug,
    catalogOrder: input.catalogOrder,
    contextLength: input.contextLength,
    createdAt: input.createdAt,
    defaultReasoningEffort,
    displayName: input.name || input.id,
    expirationDate: input.expirationDate,
    imageInputRejected: input.rejectsImages ? true : undefined,
    inputModalities: input.inputModalities,
    isFree: isFreeModel(input.id, input.pricing),
    outputModalities: input.outputModalities,
    pricing: input.pricing,
    supportedParameters: input.supportedParameters,
    supportedReasoningEfforts,
  };
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

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readAuthorSlug(modelId: string): string | undefined {
  const separator = modelId.indexOf("/");
  return separator > 0 ? modelId.slice(0, separator) : undefined;
}

function readPricing(value: unknown): DiscoveredModelPricing | undefined {
  if (!isRecord(value)) return undefined;
  const pricing = {
    completion: readString(value.completion),
    prompt: readString(value.prompt),
    request: readString(value.request),
  };
  return Object.values(pricing).some((price) => price !== undefined)
    ? pricing
    : undefined;
}

function isFreeModel(
  modelId: string,
  pricing: DiscoveredModelPricing | undefined,
): boolean {
  if (modelId.endsWith(":free")) return true;
  if (pricing?.prompt === undefined || pricing.completion === undefined) {
    return false;
  }
  return (
    Number(pricing.prompt) === 0 &&
    Number(pricing.completion) === 0 &&
    (pricing.request === undefined || Number(pricing.request) === 0)
  );
}

export {
  configuredModels,
  normalizeBaseURL,
  parseModelListParams,
  parseOpenAIModelList,
  parseOpenRouterModelList,
  providerRejectsImageInput,
  parseTurnStartParams,
  validateProfile,
};
export type { ModelListParams, TurnStartParams };
