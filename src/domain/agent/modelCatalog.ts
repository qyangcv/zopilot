import { createCapabilities } from "./capabilities";
import type {
  AgentModelEntry,
  AgentProviderId,
  ProviderProfile,
} from "./types";

export {
  CODEX_PROVIDER_ID,
  PROVIDER_CATALOG,
  createCodexProviderProfile,
  createProviderProfile,
  createLegacyProviderDisplayName,
  getProviderDefinition,
  isModelVisible,
  isProviderId,
  modelFromId,
  resolveProviderId,
};
export type { ProviderDefinition };

const CODEX_PROVIDER_ID = "codex-cli.default";

type ProviderDefinition = {
  id: AgentProviderId;
  displayName: string;
  defaultBaseURL?: string;
  domains: readonly string[];
  iconFile?: string;
  selectable: boolean;
};

/** Single source of truth for provider identity, name, endpoint, and icon. */
const PROVIDER_CATALOG: readonly ProviderDefinition[] = [
  {
    id: "codex",
    displayName: "Codex CLI",
    domains: [],
    iconFile: "codex-color.svg",
    selectable: false,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    domains: ["openrouter.ai"],
    iconFile: "openrouter.svg",
    selectable: true,
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultBaseURL: "https://api.deepseek.com",
    domains: ["deepseek.com"],
    iconFile: "deepseek-color.svg",
    selectable: true,
  },
  {
    id: "z-ai",
    displayName: "Z.AI",
    defaultBaseURL: "https://api.z.ai/api/paas/v4",
    domains: ["z.ai"],
    iconFile: "zai.svg",
    selectable: true,
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    defaultBaseURL: "https://api.minimaxi.com/v1",
    domains: ["minimaxi.com", "minimax.io"],
    iconFile: "minimax-color.svg",
    selectable: true,
  },
  {
    id: "moonshot",
    displayName: "Moonshot AI",
    defaultBaseURL: "https://api.moonshot.cn/v1",
    domains: ["moonshot.cn", "moonshot.ai"],
    iconFile: "moonshot.svg",
    selectable: true,
  },
  {
    id: "alibaba-bailian",
    displayName: "阿里云百炼",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    domains: ["dashscope.aliyuncs.com", "maas.aliyuncs.com"],
    iconFile: "bailian-color.svg",
    selectable: true,
  },
  {
    id: "xiaomi-mimo",
    displayName: "Xiaomi MiMo",
    defaultBaseURL: "https://api.xiaomimimo.com/v1",
    domains: ["xiaomimimo.com"],
    iconFile: "xiaomimimo.svg",
    selectable: true,
  },
  {
    id: "custom",
    displayName: "Custom OpenAI Compatible",
    domains: [],
    selectable: true,
  },
] as const;

function createCodexProviderProfile(
  input: {
    models?: AgentModelEntry[];
    status?: ProviderProfile["status"];
  } = {},
): ProviderProfile {
  const models = input.models || [];
  const visibleModels = models.filter(isModelVisible);
  const provider = getProviderDefinition("codex");
  return {
    id: CODEX_PROVIDER_ID,
    kind: "codex-cli",
    providerId: provider.id,
    displayName: provider.displayName,
    defaultModel: visibleModels[0]?.id,
    models,
    capabilities: createCapabilities(provider.id),
    timeoutMs: 180000,
    retryCount: 0,
    enabled: true,
    status: input.status || "unchecked",
  };
}

function createProviderProfile(input: {
  id: string;
  providerId: Exclude<AgentProviderId, "codex">;
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
  const provider = getProviderDefinition(input.providerId);
  const models = input.models?.length
    ? input.models.map((model) => ({
        ...modelFromId(model.id),
        ...(model.visible === false ? { visible: false } : {}),
      }))
    : input.defaultModel
      ? [modelFromId(input.defaultModel)]
      : [];
  const visibleModels = models.filter(isModelVisible);
  return {
    id: input.id,
    kind: "openai-compatible",
    providerId: provider.id,
    displayName: input.displayName || provider.displayName,
    baseURL: input.baseURL || provider.defaultBaseURL,
    apiKeyRef: input.apiKeyRef || input.id,
    hasApiKey: input.hasApiKey,
    defaultModel: input.defaultModel || visibleModels[0]?.id,
    models,
    capabilities: createCapabilities(provider.id, input.capabilities),
    timeoutMs: input.timeoutMs || 180000,
    retryCount: input.retryCount ?? 1,
    enabled: input.enabled ?? true,
    status: input.status || "unchecked",
  };
}

function isModelVisible(model: AgentModelEntry): boolean {
  return model.visible !== false;
}

function modelFromId(id: string): AgentModelEntry {
  const supportedReasoningEfforts = ["low", "medium", "high"];
  return {
    id,
    displayName: id,
    supportedReasoningEfforts,
    defaultReasoningEffort: "medium",
  };
}

function resolveProviderId(baseURL: string | undefined): AgentProviderId {
  if (!baseURL) return "custom";
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase().replace(/\.$/, "");
    return (
      PROVIDER_CATALOG.find((provider) =>
        provider.domains.some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        ),
      )?.id || "custom"
    );
  } catch {
    return "custom";
  }
}

function getProviderDefinition(
  providerId: AgentProviderId,
): ProviderDefinition {
  return (
    PROVIDER_CATALOG.find((provider) => provider.id === providerId) ||
    PROVIDER_CATALOG[PROVIDER_CATALOG.length - 1]
  );
}

function isProviderId(value: unknown): value is AgentProviderId {
  return PROVIDER_CATALOG.some((provider) => provider.id === value);
}

/** Retained only to recognize automatic names saved by older releases. */
function createLegacyProviderDisplayName(baseURL: string | undefined): string {
  if (!baseURL) return "OpenAI compatible";
  try {
    return new URL(baseURL).hostname.replace(/^api\./, "");
  } catch {
    return "OpenAI compatible";
  }
}
