import { getProviderProfileStore } from "../providers/ProviderProfileService";
import { createBackendForProfile } from "./BackendRegistry";
import type {
  AgentBackend,
  AgentCancelInput,
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  BackendStatusResult,
  ProviderProfile,
} from "../../domain/agent/types";
import { createLogger } from "../../runtime/logging/logger";

export { AgentBackendManager, getAgentBackendManager, shutdownAgentBackends };

type BackendManagerListener = (profiles: {
  activeProviderId: string;
  profiles: ProviderProfile[];
}) => void;

let sharedManager: AgentBackendManager | undefined;
let managerShutdownPromise: Promise<void> | undefined;
const logger = createLogger("agent.backends");

class AgentBackendManager {
  private readonly backends = new Map<string, AgentBackend>();
  private readonly listeners = new Set<BackendManagerListener>();
  private readonly disposeProfileSubscription: () => void;
  private disposePromise?: Promise<void>;

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

  async checkStatus(profileId?: string): Promise<BackendStatusResult> {
    const profile = this.getProfile(profileId);
    const result = await this.getBackend(profile.id).checkStatus();
    if (profile.kind === "codex-cli") {
      getProviderProfileStore().updateCodexProvider({
        models: result.models,
        status: result.status,
        lastCheckedAt: new Date().toISOString(),
        lastDiagnostic: result.diagnostic,
      });
    } else if (result.models) {
      getProviderProfileStore().updateProviderFromDiscovery(profile.id, {
        models: result.models,
        status: result.status,
        lastCheckedAt: new Date().toISOString(),
        lastDiagnostic: result.diagnostic,
      });
    } else {
      getProviderProfileStore().updateProvider(profile.id, {
        status: result.status,
        lastCheckedAt: new Date().toISOString(),
        lastDiagnostic: result.diagnostic,
      });
    }
    return result;
  }

  async checkActiveStatus(): Promise<BackendStatusResult> {
    return this.checkStatus();
  }

  async listModels(profileId?: string): Promise<AgentModelEntry[]> {
    const profile = this.getProfile(profileId);
    return this.getBackend(profile.id).listModels();
  }

  async listActiveModels(): Promise<AgentModelEntry[]> {
    return this.listModels();
  }

  async sendPrompt(
    input: AgentPromptInput,
    callbacks?: AgentPromptCallbacks,
  ): Promise<AgentRunResult> {
    const profile = this.getProfile(input.providerProfileId);
    return this.getBackend(profile.id).sendPrompt(input, callbacks);
  }

  async cancelTurn(input: AgentCancelInput): Promise<void> {
    const profileId = input.legacy?.codexThreadId
      ? "codex-cli.default"
      : input.providerProfileId || this.getActiveProfile().id;
    await this.getBackend(profileId).cancelTurn(input);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposeProfileSubscription();
    this.listeners.clear();
    const backends = Array.from(this.backends.values());
    this.backends.clear();
    this.disposePromise = Promise.allSettled(
      backends.map(async (backend) => {
        await backend.dispose();
      }),
    ).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") {
          logger.error("failed to dispose an agent backend", result.reason);
        }
      });
    });
    return this.disposePromise;
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

  private getProfile(profileId?: string) {
    return profileId
      ? getProviderProfileStore().getProfile(profileId) ||
          getProviderProfileStore().getActiveProfile()
      : getProviderProfileStore().getActiveProfile();
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
  if (managerShutdownPromise) {
    throw new Error("Zopilot agent backends are shutting down.");
  }
  sharedManager ??= new AgentBackendManager();
  return sharedManager;
}

function shutdownAgentBackends(): Promise<void> {
  if (managerShutdownPromise) return managerShutdownPromise;
  const manager = sharedManager;
  sharedManager = undefined;
  const pending = manager?.dispose() || Promise.resolve();
  managerShutdownPromise = pending;
  pending.then(
    () => {
      if (managerShutdownPromise === pending) {
        managerShutdownPromise = undefined;
      }
    },
    () => {
      if (managerShutdownPromise === pending) {
        managerShutdownPromise = undefined;
      }
    },
  );
  return pending;
}
