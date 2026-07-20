import { getAgentBackendManager } from "../../../application/agent/BackendManager";
import { getProviderProfileStore } from "../../../application/providers/ProviderProfileService";
import { normalizeBackendError } from "../../../domain/agent/errors";
import type {
  AgentDiagnostic,
  AgentDiagnosticCode,
  AgentModelEntry,
  ProviderProfile,
} from "../../../domain/agent/types";
import { isModelVisible } from "../../../domain/agent/modelCatalog";
import { getString } from "../../../app/localization";
import { createLogger } from "../../../runtime/logging/logger";
import { getPref, setPref } from "../../../runtime/preferences/prefs";
import type { SidebarState } from "../ui/types";
import {
  buildModelSelectionPatch,
  createReasoningPreferenceKey,
  parseSavedReasoningEfforts,
  parseSavedSelectedModels,
  resolveSelectedModel,
} from "./modelPreferences";

type ProviderCatalogControllerOptions = {
  getViewState: () => SidebarState;
  updateViewState: (patch: Partial<SidebarState>) => void;
  isDestroyed: () => boolean;
  isOpen: () => boolean;
};

const SELECTED_MODELS_PREF = "agent.selectedModels";
const MODEL_SCOPED_DIAGNOSTICS = new Set<AgentDiagnosticCode>([
  "stream_interrupted",
  "rate_limited",
  "provider_timeout",
  "provider_server_error",
  "network_unavailable",
]);
const logger = createLogger("sidebar.providers");

class ProviderCatalogController {
  private refreshPromise?: Promise<void>;
  private refreshPending = false;
  private profileCatalogSignature?: string;
  private providerRefreshSignature?: string;
  private catalogRevision = 0;

  constructor(private readonly options: ProviderCatalogControllerOptions) {}

  refresh(): Promise<void> {
    if (this.refreshPromise) {
      this.refreshPending = true;
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      do {
        this.refreshPending = false;
        await this.refreshOnce();
      } while (this.refreshPending && !this.options.isDestroyed());
    })().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  subscribe(): () => void {
    return getAgentBackendManager().subscribe((snapshot) => {
      const firstSnapshot = this.profileCatalogSignature === undefined;
      const nextSignature = createProviderCatalogSignature(snapshot);
      const nextRefreshSignature = createProviderRefreshSignature(snapshot);
      const catalogChanged =
        this.profileCatalogSignature !== undefined &&
        this.profileCatalogSignature !== nextSignature;
      const refreshRequired =
        this.providerRefreshSignature !== undefined &&
        this.providerRefreshSignature !== nextRefreshSignature;
      this.profileCatalogSignature = nextSignature;
      this.providerRefreshSignature = nextRefreshSignature;
      if (catalogChanged) {
        this.catalogRevision++;
      }
      const active = snapshot.profiles.find(
        (profile) => profile.id === snapshot.activeProviderId,
      );
      if (!active || this.options.isDestroyed()) {
        return;
      }
      if (firstSnapshot || catalogChanged) {
        this.applyCachedCatalog(snapshot.profiles, snapshot.activeProviderId);
      }
      this.options.updateViewState({ activeProviderLabel: active.displayName });
      if (refreshRequired && this.options.isOpen()) {
        void this.refresh();
      }
    });
  }

  selectModel(value: string): void {
    this.applyModelSelection(value);
  }

  selectModelEffort(value: string, effort: string): void {
    this.applyModelSelection(value, effort);
  }

  markBackendHealthy(providerProfileId?: string, model?: string): void {
    const manager = getAgentBackendManager();
    const profileId =
      providerProfileId || manager.getSnapshot().activeProviderId;
    const profile = getProviderProfileStore().getProfile(profileId);
    const lastCheckedAt = new Date().toISOString();
    const viewState = this.options.getViewState();
    const models = viewState.models.map((item) =>
      item.providerProfileId === profileId && (!model || item.slug === model)
        ? { ...item, diagnosticMessage: undefined }
        : item,
    );
    if (
      !this.options.isDestroyed() &&
      viewState.selectedProviderId === profileId &&
      (!model || viewState.selectedModel === model)
    ) {
      this.options.updateViewState({
        models,
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
      });
    } else if (!this.options.isDestroyed()) {
      this.options.updateViewState({ models });
    }
    if (!profile) return;
    if (profile.kind === "codex-cli") {
      getProviderProfileStore().updateCodexProvider({
        status: "connected",
        lastCheckedAt,
        lastDiagnostic: undefined,
      });
    } else {
      getProviderProfileStore().updateProvider(profileId, {
        status: "connected",
        lastCheckedAt,
        lastDiagnostic: undefined,
      });
    }
  }

  private applyModelSelection(value: string, effort?: string): void {
    const { providerProfileId, model } = parseModelSelectValue(value);
    const viewState = this.options.getViewState();
    const selected = viewState.models.find(
      (item) =>
        item.providerProfileId === providerProfileId && item.slug === model,
    );
    if (!selected) {
      return;
    }
    if (effort && !selected.supportedReasoningEfforts.includes(effort)) {
      return;
    }
    this.saveSelectedModel(providerProfileId, model);
    if (effort) {
      this.saveReasoningEffort(providerProfileId, model, effort);
    }
    const manager = getAgentBackendManager();
    if (manager.getSnapshot().activeProviderId !== providerProfileId) {
      manager.setActiveProvider(providerProfileId);
    }
    this.updateModelSelection(viewState.models, providerProfileId, model);
    this.options.updateViewState({
      activeProviderLabel: selected.providerLabel,
      backendStatus: selected.diagnosticMessage ? "disconnected" : "connected",
      backendDiagnosticMessage: selected.diagnosticMessage,
    });
  }

  private saveReasoningEffort(
    providerProfileId: string,
    model: string,
    effort: string,
  ): void {
    const saved = this.readSavedReasoningEfforts();
    saved[createReasoningPreferenceKey(providerProfileId, model)] = effort;
    setPref("codex.reasoningEfforts", JSON.stringify(saved));
  }

  private async refreshOnce(): Promise<void> {
    const revision = this.catalogRevision;
    try {
      const manager = getAgentBackendManager();
      const snapshot = manager.getSnapshot();
      const providerModels = await Promise.all(
        snapshot.profiles
          .filter((profile) => profile.enabled)
          .map(async (profile) => ({
            profile,
            models: await this.loadProviderModels(profile),
          })),
      );
      if (this.options.isDestroyed() || revision !== this.catalogRevision) {
        return;
      }
      const availableModels = providerModels.flatMap(({ profile, models }) =>
        models.map((model) => agentModelToSidebarModel(model, profile)),
      );
      if (!availableModels.length) {
        this.updateModelSelection([], snapshot.activeProviderId, "");
        await this.refreshActiveBackendDiagnostic();
        return;
      }
      const selected = this.resolveSelectedModel(
        availableModels,
        snapshot.activeProviderId,
      );
      this.updateModelSelection(
        availableModels,
        selected.providerProfileId,
        selected.slug,
      );
      this.options.updateViewState({
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
        activeProviderLabel: selected.providerLabel,
      });
    } catch (error) {
      logger.error("agent backend model list failed", error);
      if (this.options.isDestroyed() || revision !== this.catalogRevision) {
        return;
      }
      await this.refreshActiveBackendDiagnostic(error);
    }
  }

  async refreshActiveBackendDiagnostic(
    error?: unknown,
    providerProfileId?: string,
    model?: string,
  ): Promise<void> {
    const manager = getAgentBackendManager();
    const profileId =
      providerProfileId || manager.getSnapshot().activeProviderId;
    if (error !== undefined) {
      const diagnostic = normalizeBackendError(error);
      this.showBackendDisconnected(
        profileId,
        model,
        getRawErrorMessage(error) || diagnostic.message,
        isModelScopedProviderDiagnostic(diagnostic),
      );
      return;
    }

    try {
      const status = await manager.checkStatus(profileId);
      if (this.options.isDestroyed()) return;
      if (status.status === "connected") {
        this.markBackendHealthy(profileId, model);
        return;
      }
      this.showBackendDisconnected(
        profileId,
        model,
        status.diagnostic?.message ||
          getString("sidebar-backend-status-disconnected"),
        isModelScopedProviderDiagnostic(status.diagnostic),
      );
    } catch (statusError) {
      if (this.options.isDestroyed()) return;
      const diagnostic = normalizeBackendError(statusError);
      this.showBackendDisconnected(
        profileId,
        model,
        getRawErrorMessage(statusError) || diagnostic.message,
        isModelScopedProviderDiagnostic(diagnostic),
      );
    }
  }

  private showBackendDisconnected(
    providerProfileId: string,
    model: string | undefined,
    message: string,
    modelScoped: boolean,
  ): void {
    if (this.options.isDestroyed()) return;
    const viewState = this.options.getViewState();
    const targetModel =
      model ||
      (viewState.selectedProviderId === providerProfileId
        ? viewState.selectedModel
        : undefined);
    const hasTargetModel =
      modelScoped &&
      Boolean(targetModel) &&
      viewState.models.some(
        (item) =>
          item.providerProfileId === providerProfileId &&
          item.slug === targetModel,
      );
    if (hasTargetModel) {
      const models = viewState.models.map((item) =>
        item.providerProfileId === providerProfileId &&
        item.slug === targetModel
          ? { ...item, diagnosticMessage: message }
          : item,
      );
      const selected =
        viewState.selectedProviderId === providerProfileId &&
        viewState.selectedModel === targetModel;
      this.options.updateViewState({
        models,
        ...(selected
          ? {
              backendStatus: "disconnected" as const,
              backendDiagnosticMessage: message,
            }
          : {}),
      });
      return;
    }
    if (
      getAgentBackendManager().getSnapshot().activeProviderId ===
      providerProfileId
    ) {
      this.options.updateViewState({
        backendStatus: "disconnected",
        backendDiagnosticMessage: message,
      });
    }
  }

  private updateModelSelection(
    models: SidebarState["models"],
    selectedProviderId: string,
    selectedModel: string,
  ): void {
    this.options.updateViewState(
      buildModelSelectionPatch(
        models,
        selectedProviderId,
        selectedModel,
        this.readSavedReasoningEfforts(),
      ),
    );
  }

  private applyCachedCatalog(
    profiles: ProviderProfile[],
    activeProviderId: string,
  ): void {
    const models = createVisibleModelCatalog(profiles);
    if (!models.length) {
      this.updateModelSelection([], activeProviderId, "");
      return;
    }
    const selected = this.resolveSelectedModel(models, activeProviderId);
    this.updateModelSelection(
      models,
      selected.providerProfileId,
      selected.slug,
    );
  }

  private async loadProviderModels(
    profile: ProviderProfile,
  ): Promise<AgentModelEntry[]> {
    try {
      const manager = getAgentBackendManager();
      const status = await manager.checkStatus(profile.id);
      const latestProfile =
        manager.getSnapshot().profiles.find((item) => item.id === profile.id) ||
        profile;
      if (status.models?.length) {
        return latestProfile.models.filter(isModelVisible);
      }
      if (status.status === "connected") {
        const models = await manager.listModels(profile.id);
        const visibleIds = new Set(
          latestProfile.models.filter(isModelVisible).map((model) => model.id),
        );
        return models.filter((model) => visibleIds.has(model.id));
      }
    } catch (error) {
      logger.error("agent backend provider model list failed", error, {
        providerProfileId: profile.id,
      });
    }
    return profile.status === "connected" || profile.models.length
      ? profile.models.filter(isModelVisible)
      : [];
  }

  private resolveSelectedModel(
    models: SidebarState["models"],
    activeProviderId: string,
  ): SidebarState["models"][number] {
    const viewState = this.options.getViewState();
    return (
      resolveSelectedModel({
        models,
        activeProviderId,
        currentProviderId: viewState.selectedProviderId,
        currentModel: viewState.selectedModel,
        savedSelectedModels: this.readSavedSelectedModels(),
      }) || models[0]
    );
  }

  private readSavedReasoningEfforts(): Record<string, string> {
    return parseSavedReasoningEfforts(getPref("codex.reasoningEfforts"));
  }

  private readSavedSelectedModels(): Record<string, string> {
    return parseSavedSelectedModels(getPref(SELECTED_MODELS_PREF));
  }

  private saveSelectedModel(providerProfileId: string, model: string): void {
    const saved = this.readSavedSelectedModels();
    saved[providerProfileId] = model;
    setPref(SELECTED_MODELS_PREF, JSON.stringify(saved));
  }
}

function agentModelToSidebarModel(
  model: AgentModelEntry,
  profile: ProviderProfile,
): SidebarState["models"][number] {
  return {
    slug: model.id,
    displayName: model.displayName,
    providerProfileId: profile.id,
    providerLabel: profile.displayName,
    providerBrand: profile.providerId,
    supportedReasoningEfforts: model.supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

function parseModelSelectValue(value: string): {
  providerProfileId: string;
  model: string;
} {
  const [providerProfileId, model] = value.split("\u0000");
  return {
    providerProfileId: providerProfileId || "codex-cli.default",
    model: model || value,
  };
}

function createProviderCatalogSignature(input: {
  activeProviderId?: string;
  profiles: ProviderProfile[];
}): string {
  return JSON.stringify(
    input.profiles.map((profile) => ({
      id: profile.id,
      providerId: profile.providerId,
      displayName: profile.displayName,
      enabled: profile.enabled,
      baseURL: profile.baseURL,
      hasApiKey: profile.hasApiKey,
      capabilities: profile.capabilities,
      models: profile.models,
    })),
  );
}

function createProviderRefreshSignature(input: {
  profiles: ProviderProfile[];
}): string {
  return JSON.stringify(
    input.profiles.map((profile) => ({
      id: profile.id,
      providerId: profile.providerId,
      displayName: profile.displayName,
      enabled: profile.enabled,
      baseURL: profile.baseURL,
      hasApiKey: profile.hasApiKey,
      capabilities: profile.capabilities,
      models: profile.models.map(({ visible: _visible, ...model }) => model),
    })),
  );
}

function createVisibleModelCatalog(
  profiles: ProviderProfile[],
): SidebarState["models"] {
  return profiles
    .filter((profile) => profile.enabled)
    .flatMap((profile) =>
      profile.models
        .filter(isModelVisible)
        .map((model) => agentModelToSidebarModel(model, profile)),
    );
}

function isModelScopedProviderDiagnostic(
  diagnostic?: Pick<AgentDiagnostic, "code">,
): boolean {
  return diagnostic ? MODEL_SCOPED_DIAGNOSTICS.has(diagnostic.code) : false;
}

function getRawErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || undefined;
  if (error === undefined || error === null) return undefined;
  return String(error) || undefined;
}

export {
  ProviderCatalogController,
  createProviderCatalogSignature,
  createProviderRefreshSignature,
  createVisibleModelCatalog,
  isModelScopedProviderDiagnostic,
};
export type { ProviderCatalogControllerOptions };
