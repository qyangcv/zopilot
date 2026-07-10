import { createCapabilities } from "./capabilities";
import type {
  AgentModelEntry,
  AgentProviderPreset,
  ProviderProfile,
} from "./types";

export {
  CODEX_PROVIDER_ID,
  PROVIDER_PRESETS,
  createCodexProviderProfile,
  createPresetProviderProfile,
  createProviderDisplayName,
  modelFromId,
};

const CODEX_PROVIDER_ID = "codex-cli.default";

type PresetDefinition = {
  preset: Exclude<AgentProviderPreset, "codex-cli">;
  displayName: string;
  baseURL?: string;
};

const PROVIDER_PRESETS: PresetDefinition[] = [
  {
    preset: "openai-compatible",
    displayName: "OpenAI compatible",
  },
  {
    preset: "deepseek",
    displayName: "DeepSeek",
    baseURL: "https://api.deepseek.com",
  },
  {
    preset: "z-ai",
    displayName: "Z.AI / GLM",
    baseURL: "https://api.z.ai/api/paas/v4",
  },
  {
    preset: "minimax",
    displayName: "MiniMax",
    baseURL: "https://api.minimax.io/v1",
  },
];

function createCodexProviderProfile(
  input: {
    models?: AgentModelEntry[];
    status?: ProviderProfile["status"];
  } = {},
): ProviderProfile {
  const models = input.models || [];
  return {
    id: CODEX_PROVIDER_ID,
    kind: "codex-cli",
    preset: "codex-cli",
    displayName: "Codex CLI",
    defaultModel: models[0]?.id,
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
  preset?: Exclude<AgentProviderPreset, "codex-cli">;
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
  const presetName = input.preset || "openai-compatible";
  const preset = getPreset(presetName);
  const models = input.models?.length
    ? input.models.map((model) => modelFromId(model.id, presetName))
    : input.defaultModel
      ? [modelFromId(input.defaultModel, presetName)]
      : [];
  const defaultModel = input.defaultModel || models[0]?.id;
  return {
    id: input.id,
    kind: "openai-compatible",
    preset: presetName,
    displayName:
      input.displayName || createProviderDisplayName(input.baseURL, preset),
    baseURL: input.baseURL || preset.baseURL,
    apiKeyRef: input.apiKeyRef || input.id,
    hasApiKey: input.hasApiKey,
    defaultModel,
    models,
    capabilities: createCapabilities(presetName, input.capabilities),
    timeoutMs: input.timeoutMs || 180000,
    retryCount: input.retryCount ?? 1,
    enabled: input.enabled ?? true,
    status: input.status || "unchecked",
  };
}

function modelFromId(
  id: string,
  preset: Exclude<AgentProviderPreset, "codex-cli"> = "openai-compatible",
): AgentModelEntry {
  const supportedReasoningEfforts =
    preset === "openai-compatible" ||
    preset === "deepseek" ||
    preset === "z-ai" ||
    preset === "minimax"
      ? ["low", "medium", "high"]
      : [];
  return {
    id,
    displayName: id,
    supportedReasoningEfforts,
    defaultReasoningEffort: supportedReasoningEfforts.includes("medium")
      ? "medium"
      : undefined,
  };
}

function createProviderDisplayName(
  baseURL: string | undefined,
  preset?: PresetDefinition,
): string {
  if (preset && preset.preset !== "openai-compatible") {
    return preset.displayName;
  }
  if (!baseURL) {
    return preset?.displayName || "OpenAI compatible";
  }
  try {
    return new URL(baseURL).hostname.replace(/^api\./, "");
  } catch {
    return "OpenAI compatible";
  }
}

function getPreset(
  preset: Exclude<AgentProviderPreset, "codex-cli">,
): PresetDefinition {
  return (
    PROVIDER_PRESETS.find((item) => item.preset === preset) ||
    PROVIDER_PRESETS[0]
  );
}
