import { getPref, setPref } from "../../runtime/preferences/prefs";
import {
  CODEX_PROVIDER_ID,
  createCodexProviderProfile,
  createPresetProviderProfile,
} from "../../domain/agent/modelCatalog";
import type {
  AgentCapabilities,
  AgentModelEntry,
  ProviderProfile,
  ProviderProfileInput,
  ProviderProfileWithSecret,
} from "../../domain/agent/types";
import {
  ProviderProfileRepository,
  ACTIVE_PROVIDER_PREF,
} from "./persistence/ProviderProfileRepository";
import { ProviderSecretStore } from "./persistence/ProviderSecretStore";
import {
  createProfileId,
  normalizeStoredProfile,
  toStoredProviderProfile,
  type StoredProviderProfile,
} from "./persistence/profileCodec";

export {
  ProviderProfileStore,
  getProviderProfileStore,
  migrateLegacyProviderPrefs,
};

type ProviderProfileSnapshot = {
  activeProviderId: string;
  profiles: ProviderProfile[];
};

type ProviderProfileListener = (snapshot: ProviderProfileSnapshot) => void;

let sharedStore: ProviderProfileStore | undefined;

class ProviderProfileStore {
  private readonly listeners = new Set<ProviderProfileListener>();
  private readonly repository = new ProviderProfileRepository();
  private readonly secrets = new ProviderSecretStore();
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
    this.repository.writeActiveProviderId(profileId);
    this.notify();
  }

  createProvider(input: ProviderProfileInput): ProviderProfile {
    const preset = input.preset || "openai-compatible";
    const profile = createPresetProviderProfile({
      id: createProfileId(preset),
      preset,
      displayName: input.displayName,
      baseURL: input.baseURL,
      models: input.models,
      capabilities: input.capabilities,
      timeoutMs: input.timeoutMs,
      retryCount: input.retryCount,
      enabled: input.enabled,
      hasApiKey: Boolean(input.apiKey),
    });
    const profiles = [
      ...this.readStoredProfiles(),
      toStoredProviderProfile(profile),
    ];
    this.writeStoredProfiles(profiles);
    if (input.apiKey) {
      this.writeSecret(profile.id, input.apiKey);
    }
    this.notify();
    return this.withSecret(profile);
  }

  updateProvider(
    profileId: string,
    patch: Partial<ProviderProfileInput> & {
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
    const models = patch.models || current.models;
    const next: StoredProviderProfile = {
      ...current,
      displayName: patch.displayName ?? current.displayName,
      baseURL: patch.baseURL ?? current.baseURL,
      defaultModel: models[0]?.id,
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
    stored[index] = toStoredProviderProfile(next);
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
    setPref("codex.model", profile.defaultModel || "gpt-5.5");
    this.repository.writeCodexStatus(profile);
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
    this.secrets.delete(profileId);
    if (this.getSnapshot().activeProviderId === profileId) {
      this.repository.writeActiveProviderId(CODEX_PROVIDER_ID);
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
    const saved = this.repository.readActiveProviderId();
    if (profiles.some((item) => item.id === saved && item.enabled)) {
      return saved;
    }
    return CODEX_PROVIDER_ID;
  }

  private readProfiles(): ProviderProfile[] {
    const codexModel = String(getPref("codex.model") || "");
    const codexStatus = this.repository.readCodexStatus();
    const profiles = [
      createCodexProviderProfile({
        defaultModel: codexModel,
        models: codexStatus.models,
        status: codexStatus.status,
      }),
      ...this.readStoredProfiles().map(normalizeStoredProfile),
    ];
    profiles[0].lastCheckedAt = codexStatus.lastCheckedAt;
    profiles[0].lastDiagnostic = codexStatus.lastDiagnostic;
    return profiles.map((profile) => ({
      ...profile,
      hasApiKey:
        profile.kind === "openai-compatible"
          ? this.secrets.has(profile.apiKeyRef || profile.id)
          : undefined,
    }));
  }

  private readStoredProfiles(): StoredProviderProfile[] {
    return this.repository.readProfiles();
  }

  private writeStoredProfiles(profiles: StoredProviderProfile[]): void {
    this.repository.writeProfiles(profiles);
  }

  private withSecret(profile: ProviderProfile): ProviderProfileWithSecret {
    if (profile.kind !== "openai-compatible") {
      return profile;
    }
    return {
      ...profile,
      apiKey: this.secrets.get(profile.apiKeyRef || profile.id),
      hasApiKey: this.secrets.has(profile.apiKeyRef || profile.id),
    };
  }

  private writeSecret(profileId: string, apiKey: string): void {
    this.secrets.set(profileId, apiKey);
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
    this.repository.observe(() => this.notify());
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
