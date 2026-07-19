import { getPref, setPref } from "../../runtime/preferences/prefs";
import {
  CODEX_PROVIDER_ID,
  createCodexProviderProfile,
  createProviderProfile,
  isModelVisible,
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
  mergeDiscoveredModels,
  migrateLegacyProviderPrefs,
  shutdownProviderProfileStore,
};

type ProviderProfileSnapshot = {
  activeProviderId: string;
  profiles: ProviderProfile[];
};

type ProviderProfileListener = (snapshot: ProviderProfileSnapshot) => void;

const SELECTED_MODELS_PREF = "agent.selectedModels";

let sharedStore: ProviderProfileStore | undefined;

class ProviderProfileStore {
  private readonly listeners = new Set<ProviderProfileListener>();
  private readonly repository = new ProviderProfileRepository();
  private readonly secrets = new ProviderSecretStore();
  private prefObserverDisposer?: () => void;
  private notificationQueued = false;

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
    this.notifySoon();
  }

  createProvider(input: ProviderProfileInput): ProviderProfile {
    const profile = createProviderProfile({
      id: createProfileId(input.providerId),
      providerId: input.providerId,
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
    this.notifySoon();
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
    const visibleModels = models.filter(isModelVisible);
    const next: StoredProviderProfile = {
      ...current,
      displayName: patch.displayName ?? current.displayName,
      baseURL: patch.baseURL ?? current.baseURL,
      defaultModel: visibleModels[0]?.id,
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
    this.notifySoon();
    return this.withSecret(next);
  }

  updateProviderFromDiscovery(
    profileId: string,
    input: {
      models: AgentModelEntry[];
      status: ProviderProfile["status"];
      lastCheckedAt?: string;
      lastDiagnostic?: ProviderProfile["lastDiagnostic"];
    },
  ): ProviderProfile | undefined {
    const profile = this.getSnapshot().profiles.find(
      (item) => item.id === profileId,
    );
    if (!profile || profile.kind === "codex-cli") {
      return undefined;
    }
    return this.updateProvider(profileId, {
      ...input,
      models: mergeDiscoveredModels(profile.models, input.models, false),
    });
  }

  updateCodexProvider(input: {
    models?: AgentModelEntry[];
    status?: ProviderProfile["status"];
    lastCheckedAt?: string;
    lastDiagnostic?: ProviderProfile["lastDiagnostic"];
  }): ProviderProfile {
    const current = this.repository.readCodexStatus();
    const profile = createCodexProviderProfile({
      models: input.models
        ? mergeDiscoveredModels(current.models || [], input.models, true)
        : current.models,
      status: input.status,
    });
    profile.lastCheckedAt = input.lastCheckedAt;
    profile.lastDiagnostic = input.lastDiagnostic;
    this.repository.writeCodexStatus(profile);
    this.notifySoon();
    return profile;
  }

  setModelVisibility(
    profileId: string,
    modelId: string,
    visible: boolean,
  ): boolean {
    const profile = this.getSnapshot().profiles.find(
      (item) => item.id === profileId,
    );
    const model = profile?.models.find((item) => item.id === modelId);
    if (!profile || !model || isModelVisible(model) === visible) {
      return false;
    }
    if (!visible && profile.models.filter(isModelVisible).length <= 1) {
      return false;
    }

    const models = profile.models.map((item) =>
      item.id === modelId ? setModelVisible(item, visible) : item,
    );
    if (profile.kind === "codex-cli") {
      const next = createCodexProviderProfile({
        models,
        status: profile.status,
      });
      next.lastCheckedAt = profile.lastCheckedAt;
      next.lastDiagnostic = profile.lastDiagnostic;
      this.repository.writeCodexStatus(next);
      this.notifySoon();
    } else {
      this.updateProvider(profileId, { models });
    }
    this.resolveHiddenSelectedModel(profile, modelId, models);
    return true;
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
    this.notifySoon();
  }

  subscribe(listener: ProviderProfileListener): () => void {
    this.ensurePrefObserver();
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPrefObserver();
    };
  }

  dispose(): void {
    this.listeners.clear();
    this.stopPrefObserver();
    this.notificationQueued = false;
  }

  private resolveActiveProviderId(profiles: ProviderProfile[]): string {
    const saved = this.repository.readActiveProviderId();
    if (profiles.some((item) => item.id === saved && item.enabled)) {
      return saved;
    }
    return CODEX_PROVIDER_ID;
  }

  private readProfiles(): ProviderProfile[] {
    const codexStatus = this.repository.readCodexStatus();
    const profiles = [
      createCodexProviderProfile({
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

  private resolveHiddenSelectedModel(
    profile: ProviderProfile,
    hiddenModelId: string,
    models: AgentModelEntry[],
  ): void {
    const saved = parseSelectedModels(getPref(SELECTED_MODELS_PREF));
    const selectedModel = saved[profile.id] || profile.defaultModel;
    if (selectedModel !== hiddenModelId) {
      return;
    }
    const fallback = models.find(isModelVisible);
    if (!fallback) {
      return;
    }
    saved[profile.id] = fallback.id;
    setPref(SELECTED_MODELS_PREF, JSON.stringify(saved));
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private notifySoon(): void {
    if (this.notificationQueued) return;
    this.notificationQueued = true;
    void Promise.resolve().then(() => {
      this.notificationQueued = false;
      if (this.listeners.size > 0) this.notify();
    });
  }

  private ensurePrefObserver(): void {
    if (this.prefObserverDisposer) return;
    this.prefObserverDisposer = this.repository.observe(() =>
      this.notifySoon(),
    );
  }

  private stopPrefObserver(): void {
    this.prefObserverDisposer?.();
    this.prefObserverDisposer = undefined;
  }
}

function mergeDiscoveredModels(
  current: AgentModelEntry[],
  discovered: AgentModelEntry[],
  newModelsVisible: boolean,
): AgentModelEntry[] {
  const currentById = new Map(current.map((model) => [model.id, model]));
  const merged = discovered.map((model) => {
    const existing = currentById.get(model.id);
    return setModelVisible(
      model,
      existing ? isModelVisible(existing) : newModelsVisible,
    );
  });
  if (merged.length && !merged.some(isModelVisible)) {
    merged[0] = setModelVisible(merged[0], true);
  }
  return merged;
}

function setModelVisible(
  model: AgentModelEntry,
  visible: boolean,
): AgentModelEntry {
  const { visible: _visible, ...entry } = model;
  return visible ? entry : { ...entry, visible: false };
}

function parseSelectedModels(raw: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw || "{}")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function getProviderProfileStore(): ProviderProfileStore {
  sharedStore ??= new ProviderProfileStore();
  return sharedStore;
}

function shutdownProviderProfileStore(): void {
  sharedStore?.dispose();
  sharedStore = undefined;
}

function migrateLegacyProviderPrefs(): void {
  const active = String(getPref(ACTIVE_PROVIDER_PREF) || "");
  if (!active) {
    setPref(ACTIVE_PROVIDER_PREF, CODEX_PROVIDER_ID);
  }
}
