import { createPresetProviderProfile } from "../../../domain/agent/modelCatalog";
import type {
  AgentModelEntry,
  AgentProviderPreset,
  ProviderProfile,
} from "../../../domain/agent/types";
import { createTimestampId } from "../../../runtime/ids/timestampId";

type StoredProviderProfile = Omit<
  ProviderProfile,
  "hasApiKey" | "lastDiagnostic"
> & {
  hasApiKey?: never;
  lastDiagnostic?: ProviderProfile["lastDiagnostic"];
};

type StoredCodexStatus = {
  models?: AgentModelEntry[];
  status?: ProviderProfile["status"];
  lastCheckedAt?: string;
  lastDiagnostic?: ProviderProfile["lastDiagnostic"];
};

function parseStoredProfiles(raw: unknown): StoredProviderProfile[] {
  try {
    const parsed = JSON.parse(String(raw || "[]")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) =>
        item && typeof item === "object"
          ? normalizeStoredProfile(item as Partial<ProviderProfile>)
          : undefined,
      )
      .filter((item): item is StoredProviderProfile => Boolean(item));
  } catch {
    return [];
  }
}

function normalizeStoredProfile(
  input: Partial<ProviderProfile>,
): StoredProviderProfile {
  const preset = isOpenAICompatiblePreset(input.preset)
    ? input.preset
    : "openai-compatible";
  return toStoredProviderProfile(
    createPresetProviderProfile({
      id: typeof input.id === "string" ? input.id : createProfileId(preset),
      preset,
      displayName: input.displayName,
      baseURL: input.baseURL,
      models: Array.isArray(input.models) ? input.models : undefined,
      defaultModel:
        typeof input.defaultModel === "string" ? input.defaultModel : undefined,
      capabilities: input.capabilities,
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      enabled: input.enabled,
      status: input.status,
      apiKeyRef: input.apiKeyRef,
    }),
  );
}

function toStoredProviderProfile(
  profile: ProviderProfile | StoredProviderProfile,
): StoredProviderProfile {
  const { hasApiKey: _hasApiKey, lastDiagnostic, status, ...stored } = profile;
  return {
    ...stored,
    status: status || "unchecked",
    lastDiagnostic,
  };
}

function parseStoredCodexStatus(raw: unknown): StoredCodexStatus {
  try {
    const parsed = JSON.parse(String(raw || "{}")) as
      | Partial<ProviderProfile>
      | undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return {
      models: Array.isArray(parsed.models) ? parsed.models : undefined,
      status: isProviderStatus(parsed.status) ? parsed.status : undefined,
      lastCheckedAt:
        typeof parsed.lastCheckedAt === "string"
          ? parsed.lastCheckedAt
          : undefined,
      lastDiagnostic:
        parsed.lastDiagnostic && typeof parsed.lastDiagnostic === "object"
          ? parsed.lastDiagnostic
          : undefined,
    };
  } catch {
    return {};
  }
}

function toStoredCodexStatus(profile: ProviderProfile): StoredCodexStatus {
  return {
    models: profile.models,
    status: profile.status,
    lastCheckedAt: profile.lastCheckedAt,
    lastDiagnostic: profile.lastDiagnostic,
  };
}

function isProviderStatus(value: unknown): value is ProviderProfile["status"] {
  return (
    value === "unchecked" ||
    value === "checking" ||
    value === "connected" ||
    value === "disconnected"
  );
}

function isOpenAICompatiblePreset(
  preset: unknown,
): preset is Exclude<AgentProviderPreset, "codex-cli"> {
  return (
    preset === "openai-compatible" ||
    preset === "deepseek" ||
    preset === "z-ai" ||
    preset === "minimax"
  );
}

function createProfileId(preset: AgentProviderPreset): string {
  return createTimestampId(preset, { separator: ".", randomLength: 6 });
}

export {
  createProfileId,
  normalizeStoredProfile,
  parseStoredCodexStatus,
  parseStoredProfiles,
  toStoredCodexStatus,
  toStoredProviderProfile,
};
export type { StoredCodexStatus, StoredProviderProfile };
