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
  createLegacyProviderDisplayName,
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

/**
 * Display names for well-known OpenAI-compatible endpoints. Keep transport
 * presets separate from branding: most of these providers use the generic
 * OpenAI-compatible backend, but should still have a human-friendly name.
 */
const PROVIDER_DOMAIN_NAMES: ReadonlyArray<{
  domains: readonly string[];
  displayName: string;
}> = [
  { domains: ["deepseek.com"], displayName: "DeepSeek" },
  { domains: ["openai.com"], displayName: "OpenAI" },
  { domains: ["openrouter.ai"], displayName: "OpenRouter" },
  { domains: ["z.ai"], displayName: "Z.AI / GLM" },
  { domains: ["bigmodel.cn"], displayName: "Zhipu AI / GLM" },
  { domains: ["minimax.io", "minimaxi.com"], displayName: "MiniMax" },
  { domains: ["moonshot.cn", "moonshot.ai"], displayName: "Moonshot AI" },
  {
    domains: ["siliconflow.cn", "siliconflow.com"],
    displayName: "SiliconFlow",
  },
  { domains: ["dashscope.aliyuncs.com"], displayName: "Alibaba Cloud / Qwen" },
  { domains: ["volces.com"], displayName: "Volcano Engine / Ark" },
  { domains: ["together.xyz"], displayName: "Together AI" },
  { domains: ["fireworks.ai"], displayName: "Fireworks AI" },
  { domains: ["mistral.ai"], displayName: "Mistral AI" },
  { domains: ["x.ai"], displayName: "xAI" },
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
    const hostname = new URL(baseURL).hostname.toLowerCase().replace(/\.$/, "");
    const knownProvider = PROVIDER_DOMAIN_NAMES.find(({ domains }) =>
      domains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      ),
    );
    return (
      knownProvider?.displayName || createLegacyProviderDisplayName(baseURL)
    );
  } catch {
    return "OpenAI compatible";
  }
}

/** The pre-branding name is retained so persisted automatic names can migrate. */
function createLegacyProviderDisplayName(baseURL: string | undefined): string {
  if (!baseURL) return "OpenAI compatible";
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
