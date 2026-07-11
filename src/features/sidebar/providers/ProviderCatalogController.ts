import { getAgentBackendManager } from "../../../application/agent/BackendManager";
import type {
  AgentDiagnostic,
  AgentModelEntry,
  ProviderProfile,
} from "../../../domain/agent/types";
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
const logger = createLogger("sidebar.providers");

class ProviderCatalogController {
  private refreshPromise?: Promise<void>;

  constructor(private readonly options: ProviderCatalogControllerOptions) {}

  refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.refreshOnce().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  subscribe(): () => void {
    return getAgentBackendManager().subscribe((snapshot) => {
      const active = snapshot.profiles.find(
        (profile) => profile.id === snapshot.activeProviderId,
      );
      if (!active || this.options.isDestroyed()) {
        return;
      }
      this.options.updateViewState({ activeProviderLabel: active.displayName });
      if (this.options.isOpen()) {
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
    this.options.updateViewState({
      backendStatus: "checking",
      backendDiagnosticMessage: undefined,
    });
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
      if (this.options.isDestroyed()) {
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
      if (this.options.isDestroyed()) {
        return;
      }
      this.updateModelSelection(
        [],
        getAgentBackendManager().getSnapshot().activeProviderId,
        "",
      );
      await this.refreshActiveBackendDiagnostic(error);
    }
  }

  async refreshActiveBackendDiagnostic(error?: unknown): Promise<void> {
    this.options.updateViewState({
      backendStatus: "disconnected",
      backendDiagnosticMessage: undefined,
    });
    let diagnostic: AgentDiagnostic | undefined;
    try {
      diagnostic = (await getAgentBackendManager().checkActiveStatus())
        .diagnostic;
    } catch {
      diagnostic = undefined;
    }
    if (this.options.isDestroyed()) {
      return;
    }
    this.options.updateViewState({
      backendStatus: "disconnected",
      backendDiagnosticMessage:
        diagnostic?.message ||
        (error instanceof Error ? error.message : undefined) ||
        getString("sidebar-backend-status-disconnected"),
    });
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

  private async loadProviderModels(
    profile: ProviderProfile,
  ): Promise<AgentModelEntry[]> {
    try {
      const status = await getAgentBackendManager().checkStatus(profile.id);
      if (status.models?.length) {
        return status.models;
      }
      if (status.status === "connected") {
        return await getAgentBackendManager().listModels(profile.id);
      }
    } catch (error) {
      logger.error("agent backend provider model list failed", error, {
        providerProfileId: profile.id,
      });
    }
    return profile.status === "connected" || profile.models.length
      ? profile.models
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

export { ProviderCatalogController };
export type { ProviderCatalogControllerOptions };
