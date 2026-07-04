import { getProviderProfileStore } from "./providerProfiles";
import { createBackendForProfile } from "./registry";
import type {
  AgentBackend,
  AgentCancelInput,
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  BackendStatusResult,
  ProviderProfile,
} from "./types";

export { AgentBackendManager, getAgentBackendManager, shutdownAgentBackends };

type BackendManagerListener = (profiles: {
  activeProviderId: string;
  profiles: ProviderProfile[];
}) => void;

let sharedManager: AgentBackendManager | undefined;

class AgentBackendManager {
  private readonly backends = new Map<string, AgentBackend>();
  private readonly listeners = new Set<BackendManagerListener>();
  private readonly disposeProfileSubscription: () => void;

  constructor() {
    this.disposeProfileSubscription = getProviderProfileStore().subscribe(
      (snapshot) => {
        this.pruneBackends(snapshot.profiles);
        for (const listener of this.listeners) {
          listener(snapshot);
        }
      },
    );
  }

  getActiveProfile() {
    return getProviderProfileStore().getActiveProfile();
  }

  getSnapshot() {
    return getProviderProfileStore().getSnapshot();
  }

  setActiveProvider(profileId: string): void {
    getProviderProfileStore().setActiveProvider(profileId);
  }

  subscribe(listener: BackendManagerListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkActiveStatus(): Promise<BackendStatusResult> {
    const profile = this.getActiveProfile();
    const result = await this.getBackend(profile.id).checkStatus();
    if (profile.kind === "codex-cli") {
      getProviderProfileStore().updateCodexProvider({
        defaultModel: profile.defaultModel,
        models: result.models,
        status: result.status,
        lastCheckedAt: new Date().toISOString(),
        lastDiagnostic: result.diagnostic,
      });
    } else {
      getProviderProfileStore().updateProvider(profile.id, {
        status: result.status,
        models: result.models,
        lastCheckedAt: new Date().toISOString(),
        lastDiagnostic: result.diagnostic,
      });
    }
    return result;
  }

  async listActiveModels(): Promise<AgentModelEntry[]> {
    const profile = this.getActiveProfile();
    return this.getBackend(profile.id).listModels();
  }

  async sendPrompt(
    input: AgentPromptInput,
    callbacks?: AgentPromptCallbacks,
  ): Promise<AgentRunResult> {
    const profile = this.getActiveProfile();
    return this.getBackend(profile.id).sendPrompt(input, callbacks);
  }

  async cancelTurn(input: AgentCancelInput): Promise<void> {
    const profileId = input.legacy?.codexThreadId
      ? "codex-cli.default"
      : this.getActiveProfile().id;
    await this.getBackend(profileId).cancelTurn(input);
  }

  dispose(): void {
    this.disposeProfileSubscription();
    for (const backend of this.backends.values()) {
      void backend.dispose();
    }
    this.backends.clear();
  }

  private getBackend(profileId: string): AgentBackend {
    const cached = this.backends.get(profileId);
    if (cached) {
      return cached;
    }
    const profile =
      getProviderProfileStore().getProfile(profileId) ||
      getProviderProfileStore().getActiveProfile();
    const backend = createBackendForProfile(profile);
    this.backends.set(profile.id, backend);
    return backend;
  }

  private pruneBackends(profiles: ProviderProfile[]): void {
    const ids = new Set(profiles.map((profile) => profile.id));
    for (const [id, backend] of this.backends) {
      if (ids.has(id)) {
        continue;
      }
      void backend.dispose();
      this.backends.delete(id);
    }
  }
}

function getAgentBackendManager(): AgentBackendManager {
  sharedManager ??= new AgentBackendManager();
  return sharedManager;
}

function shutdownAgentBackends(): void {
  sharedManager?.dispose();
  sharedManager = undefined;
}
