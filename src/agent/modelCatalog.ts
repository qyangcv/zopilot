import { createCapabilities } from "./capabilities";
import type {
  AgentModelEntry,
  AgentProviderPreset,
  ProviderProfile,
} from "./types";

export {
  CODEX_PROVIDER_ID,
  DEFAULT_CODEX_MODEL,
  PROVIDER_PRESETS,
  createCodexProviderProfile,
  createPresetProviderProfile,
  modelFromId,
};

const CODEX_PROVIDER_ID = "codex-cli.default";

const DEFAULT_CODEX_MODEL: AgentModelEntry = {
  id: "gpt-5.5",
  displayName: "GPT-5.5",
  supportedReasoningEfforts: ["medium"],
  defaultReasoningEffort: "medium",
};

type PresetDefinition = {
  preset: Exclude<AgentProviderPreset, "codex-cli">;
  displayName: string;
  baseURL: string;
  defaultModel: string;
};

const PROVIDER_PRESETS: PresetDefinition[] = [
  {
    preset: "deepseek",
    displayName: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  {
    preset: "z-ai",
    displayName: "Z.AI / GLM",
    baseURL: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4.5",
  },
  {
    preset: "minimax",
    displayName: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
    defaultModel: "MiniMax-M1",
  },
];

function createCodexProviderProfile(
  input: {
    defaultModel?: string;
    models?: AgentModelEntry[];
    status?: ProviderProfile["status"];
  } = {},
): ProviderProfile {
  const models = input.models?.length ? input.models : [DEFAULT_CODEX_MODEL];
  const defaultModel =
    input.defaultModel &&
    models.some((model) => model.id === input.defaultModel)
      ? input.defaultModel
      : models[0]?.id || DEFAULT_CODEX_MODEL.id;
  return {
    id: CODEX_PROVIDER_ID,
    kind: "codex-cli",
    preset: "codex-cli",
    displayName: "Codex CLI",
    defaultModel,
    models,
    capabilities: createCapabilities("codex-cli"),
    timeoutMs: 180000,
    retryCount: 0,
    enabled: true,
    status: input.status || "unchecked",
  };
}

function createPresetProviderProfile(input: {
  id: string;
  preset: Exclude<AgentProviderPreset, "codex-cli">;
  displayName?: string;
  baseURL?: string;
  defaultModel?: string;
  models?: AgentModelEntry[];
  capabilities?: Partial<ProviderProfile["capabilities"]>;
  timeoutMs?: number;
  retryCount?: number;
  enabled?: boolean;
  status?: ProviderProfile["status"];
  hasApiKey?: boolean;
  apiKeyRef?: string;
}): ProviderProfile {
  const preset = getPreset(input.preset);
  const defaultModel = input.defaultModel || preset.defaultModel;
  const models = input.models?.length
    ? input.models
    : [modelFromId(defaultModel)];
  return {
    id: input.id,
    kind: "openai-compatible",
    preset: input.preset,
    displayName: input.displayName || preset.displayName,
    baseURL: input.baseURL || preset.baseURL,
    apiKeyRef: input.apiKeyRef || input.id,
    hasApiKey: input.hasApiKey,
    defaultModel,
    models,
    capabilities: createCapabilities(input.preset, input.capabilities),
    timeoutMs: input.timeoutMs || 180000,
    retryCount: input.retryCount ?? 1,
    enabled: input.enabled ?? true,
    status: input.status || "unchecked",
  };
}

function modelFromId(id: string): AgentModelEntry {
  return {
    id,
    displayName: id,
    supportedReasoningEfforts: [],
  };
}

function getPreset(
  preset: Exclude<AgentProviderPreset, "codex-cli">,
): PresetDefinition {
  return (
    PROVIDER_PRESETS.find((item) => item.preset === preset) ||
    PROVIDER_PRESETS[0]
  );
}
