import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import {
  CODEX_PROVIDER_ID,
  createCodexProviderProfile,
  createPresetProviderProfile,
  modelFromId,
} from "./modelCatalog";
import type {
  AgentCapabilities,
  AgentModelEntry,
  AgentProviderPreset,
  ProviderProfile,
  ProviderProfileInput,
  ProviderProfileWithSecret,
} from "./types";

export {
  ProviderProfileStore,
  getProviderProfileStore,
  migrateLegacyProviderPrefs,
};

type StoredProviderProfile = Omit<
  ProviderProfile,
  "hasApiKey" | "lastDiagnostic"
> & {
  hasApiKey?: never;
  lastDiagnostic?: ProviderProfile["lastDiagnostic"];
};

type ProviderProfileSnapshot = {
  activeProviderId: string;
  profiles: ProviderProfile[];
};

type ProviderSecrets = Record<string, string>;

type ProviderProfileListener = (snapshot: ProviderProfileSnapshot) => void;

const PREFS_PREFIX = config.prefsPrefix;
const PROVIDERS_PREF = "agent.providerProfiles";
const ACTIVE_PROVIDER_PREF = "agent.activeProviderId";
const SECRETS_PREF = "agent.providerSecrets";

let sharedStore: ProviderProfileStore | undefined;

class ProviderProfileStore {
  private readonly listeners = new Set<ProviderProfileListener>();
  private observing = false;

  getSnapshot(): ProviderProfileSnapshot {
    const profiles = this.readProfiles();
    const activeProviderId = this.resolveActiveProviderId(profiles);
    return { activeProviderId, profiles };
  }

  getActiveProfile(): ProviderProfileWithSecret {
    const snapshot = this.getSnapshot();
    return this.withSecret(
      snapshot.profiles.find((item) => item.id === snapshot.activeProviderId) ||
        snapshot.profiles[0],
    );
  }

  getProfile(profileId: string): ProviderProfileWithSecret | undefined {
    const profile = this.getSnapshot().profiles.find(
      (item) => item.id === profileId,
    );
    return profile ? this.withSecret(profile) : undefined;
  }

  setActiveProvider(profileId: string): void {
    const profiles = this.getSnapshot().profiles;
    if (!profiles.some((item) => item.id === profileId && item.enabled)) {
      return;
    }
    setPref(ACTIVE_PROVIDER_PREF, profileId);
    this.notify();
  }

  createProvider(input: ProviderProfileInput): ProviderProfile {
    const profile = createPresetProviderProfile({
      id: createProfileId(input.preset),
      preset: input.preset,
      displayName: input.displayName,
      baseURL: input.baseURL,
      defaultModel: input.defaultModel,
      models: input.defaultModel ? [modelFromId(input.defaultModel)] : [],
      capabilities: input.capabilities,
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      enabled: input.enabled,
      hasApiKey: Boolean(input.apiKey),
    });
    const profiles = [...this.readStoredProfiles(), stripEphemeral(profile)];
    this.writeStoredProfiles(profiles);
    if (input.apiKey) {
      this.writeSecret(profile.id, input.apiKey);
    }
    setPref(ACTIVE_PROVIDER_PREF, profile.id);
    this.notify();
    return this.withSecret(profile);
  }

  updateProvider(
    profileId: string,
    patch: Partial<ProviderProfileInput> & {
      defaultModel?: string;
      models?: AgentModelEntry[];
      capabilities?: Partial<AgentCapabilities>;
      status?: ProviderProfile["status"];
      lastCheckedAt?: string;
      lastDiagnostic?: ProviderProfile["lastDiagnostic"];
    },
  ): ProviderProfile | undefined {
    const stored = this.readStoredProfiles();
    const index = stored.findIndex((item) => item.id === profileId);
    if (index < 0 || profileId === CODEX_PROVIDER_ID) {
      return undefined;
    }
    const current = normalizeStoredProfile(stored[index]);
    const models =
      patch.models ||
      (patch.defaultModel ? [modelFromId(patch.defaultModel)] : current.models);
    const defaultModel = resolveDefaultModel({
      current: current.defaultModel,
      models,
      patch: patch.defaultModel,
    });
    const next: StoredProviderProfile = {
      ...current,
      displayName: patch.displayName ?? current.displayName,
      baseURL: patch.baseURL ?? current.baseURL,
      defaultModel,
      models,
      capabilities: {
        ...current.capabilities,
        ...patch.capabilities,
      },
      timeoutMs: patch.timeoutMs ?? current.timeoutMs,
      retryCount: patch.retryCount ?? current.retryCount,
      enabled: patch.enabled ?? current.enabled,
      status: patch.status ?? current.status,
      lastCheckedAt: patch.lastCheckedAt ?? current.lastCheckedAt,
      lastDiagnostic:
        patch.lastDiagnostic === undefined
          ? current.lastDiagnostic
          : patch.lastDiagnostic,
    };
    stored[index] = stripEphemeral(next);
    this.writeStoredProfiles(stored);
    if (patch.apiKey !== undefined) {
      this.writeSecret(profileId, patch.apiKey);
    }
    this.notify();
    return this.withSecret(next);
  }

  updateCodexProvider(input: {
    defaultModel?: string;
    models?: AgentModelEntry[];
    status?: ProviderProfile["status"];
    lastCheckedAt?: string;
    lastDiagnostic?: ProviderProfile["lastDiagnostic"];
  }): ProviderProfile {
    const profile = createCodexProviderProfile({
      defaultModel: input.defaultModel,
      models: input.models,
      status: input.status,
    });
    profile.lastCheckedAt = input.lastCheckedAt;
    profile.lastDiagnostic = input.lastDiagnostic;
    setPref("codex.model", profile.defaultModel);
    this.notify();
    return profile;
  }

  deleteProvider(profileId: string): void {
    if (profileId === CODEX_PROVIDER_ID) {
      return;
    }
    const profiles = this.readStoredProfiles().filter(
      (item) => item.id !== profileId,
    );
    this.writeStoredProfiles(profiles);
    const secrets = readSecrets();
    delete secrets[profileId];
    writeSecrets(secrets);
    if (this.getSnapshot().activeProviderId === profileId) {
      setPref(ACTIVE_PROVIDER_PREF, CODEX_PROVIDER_ID);
    }
    this.notify();
  }

  subscribe(listener: ProviderProfileListener): () => void {
    this.ensurePrefObserver();
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private resolveActiveProviderId(profiles: ProviderProfile[]): string {
    const saved = String(getPref(ACTIVE_PROVIDER_PREF) || "");
    if (profiles.some((item) => item.id === saved && item.enabled)) {
      return saved;
    }
    return CODEX_PROVIDER_ID;
  }

  private readProfiles(): ProviderProfile[] {
    const codexModel = String(getPref("codex.model") || "");
    const profiles = [
      createCodexProviderProfile({
        defaultModel: codexModel,
      }),
      ...this.readStoredProfiles().map(normalizeStoredProfile),
    ];
    const secrets = readSecrets();
    return profiles.map((profile) => ({
      ...profile,
      hasApiKey:
        profile.kind === "openai-compatible"
          ? Boolean(secrets[profile.apiKeyRef || profile.id])
          : undefined,
    }));
  }

  private readStoredProfiles(): StoredProviderProfile[] {
    return parseStoredProfiles(getPref(PROVIDERS_PREF));
  }

  private writeStoredProfiles(profiles: StoredProviderProfile[]): void {
    setPref(PROVIDERS_PREF, JSON.stringify(profiles.map(stripEphemeral)));
  }

  private withSecret(profile: ProviderProfile): ProviderProfileWithSecret {
    if (profile.kind !== "openai-compatible") {
      return profile;
    }
    const secrets = readSecrets();
    return {
      ...profile,
      apiKey: secrets[profile.apiKeyRef || profile.id],
      hasApiKey: Boolean(secrets[profile.apiKeyRef || profile.id]),
    };
  }

  private writeSecret(profileId: string, apiKey: string): void {
    const secrets = readSecrets();
    if (apiKey.trim()) {
      secrets[profileId] = apiKey.trim();
    } else {
      delete secrets[profileId];
    }
    writeSecrets(secrets);
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private ensurePrefObserver(): void {
    if (this.observing) {
      return;
    }
    this.observing = true;
    const prefs = Zotero.Prefs as typeof Zotero.Prefs & {
      registerObserver?: (
        key: string,
        callback: () => void,
        weak?: boolean,
      ) => unknown;
    };
    prefs.registerObserver?.(`${PREFS_PREFIX}.${PROVIDERS_PREF}`, () =>
      this.notify(),
    );
    prefs.registerObserver?.(`${PREFS_PREFIX}.${ACTIVE_PROVIDER_PREF}`, () =>
      this.notify(),
    );
    prefs.registerObserver?.(`${PREFS_PREFIX}.${SECRETS_PREF}`, () =>
      this.notify(),
    );
    prefs.registerObserver?.(`${PREFS_PREFIX}.codex.model`, () =>
      this.notify(),
    );
  }
}

function getProviderProfileStore(): ProviderProfileStore {
  sharedStore ??= new ProviderProfileStore();
  return sharedStore;
}

function migrateLegacyProviderPrefs(): void {
  const active = String(getPref(ACTIVE_PROVIDER_PREF) || "");
  if (!active) {
    setPref(ACTIVE_PROVIDER_PREF, CODEX_PROVIDER_ID);
  }
}

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
    : "deepseek";
  return stripEphemeral(
    createPresetProviderProfile({
      id: typeof input.id === "string" ? input.id : createProfileId(preset),
      preset,
      displayName: input.displayName,
      baseURL: input.baseURL,
      defaultModel: input.defaultModel,
      models: Array.isArray(input.models) ? input.models : undefined,
      capabilities: input.capabilities,
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      enabled: input.enabled,
      status: input.status,
      apiKeyRef: input.apiKeyRef,
    }),
  );
}

function stripEphemeral(
  profile: ProviderProfile | StoredProviderProfile,
): StoredProviderProfile {
  const { hasApiKey: _hasApiKey, lastDiagnostic, status, ...stored } = profile;
  return {
    ...stored,
    status: status || "unchecked",
    lastDiagnostic,
  };
}

function readSecrets(): ProviderSecrets {
  try {
    const parsed = JSON.parse(String(getPref(SECRETS_PREF) || "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === "string" && typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeSecrets(secrets: ProviderSecrets): void {
  setPref(SECRETS_PREF, JSON.stringify(secrets));
}

function isOpenAICompatiblePreset(
  preset: unknown,
): preset is Exclude<AgentProviderPreset, "codex-cli"> {
  return preset === "deepseek" || preset === "z-ai" || preset === "minimax";
}

function createProfileId(preset: AgentProviderPreset): string {
  return `${preset}.${Date.now().toString(36)}.${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function resolveDefaultModel(input: {
  current: string;
  models: AgentModelEntry[];
  patch?: string;
}): string {
  const requested = input.patch || input.current;
  if (input.models.some((model) => model.id === requested)) {
    return requested;
  }
  return input.models[0]?.id || requested;
}
