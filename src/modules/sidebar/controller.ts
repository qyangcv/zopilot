import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
import { getAgentBackendManager } from "../../agent/backendManager";
import { getProviderProfileStore } from "../../agent/providerProfiles";
import type {
  AgentDiagnostic,
  AgentModelEntry,
  AgentRunResult,
  ProviderProfile,
} from "../../agent/types";
import type {
  Conversation,
  LocalAttachmentRef,
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
  WorkspaceType,
} from "../../shared/conversation";
import {
  createItemWorkspaceIdentity,
  createPaperIdentity,
} from "../../shared/conversation";
import { getConversationStore } from "../../store/conversationStore";
import { getPref, setPref } from "../../utils/prefs";
import { createLogger } from "../../utils/logger";
import {
  getPdfHelperStatus,
  type PdfHelperStatus,
} from "../../document/pdfHelper";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import {
  ZoteroSourceUniverse,
  paperSourceRefToIdentity,
} from "../../zotero/sourceUniverse";
import {
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  isPDFReader,
} from "../../zotero/reader";
import { pickLocalAttachment } from "./attachmentUpload";
import { copyText } from "./app/clipboard";
import type { ReaderLocator } from "./readerNavigation";
import { navigateReaderLocator } from "./readerNavigation";
import type {
  SidebarMessageView,
  SidebarPromptSubmission,
  SidebarState,
} from "./app/types";
import {
  ContextPaneDeckAdapter,
  type ContextPaneActiveState,
} from "./contextPane";
import { createZopilotDeckHost, type ZopilotDeckHost } from "./deckHost";
import { STYLE_URI } from "./constants";
import { ReaderToolbarController } from "./readerToolbar";
import { getSelectedItemTitle } from "./selectedItem";
import { SidebarSessionCoordinator } from "./sessionCoordinator";
import { loadPromptViews, subscribePromptViews } from "./promptStore";
import {
  DEFAULT_MODEL,
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
} from "./viewModel";
import {
  buildModelSelectionPatch,
  createReasoningPreferenceKey,
  getReasoningEffortsForModel,
  parseSavedReasoningEfforts,
  parseSavedSelectedModels,
  resolveSelectedModel,
} from "./modelPreferences";
import {
  createPdfHelperNoticeText,
  isPdfHelperCurrentForPrompt,
} from "./pdfHelperGate";

const controllers = new WeakMap<Window, SidebarController>();
const TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";
const SELECTED_MODELS_PREF = "agent.selectedModels";
const logger = createLogger("sidebar.controller");
export { registerSidebar, unregisterSidebar, unregisterAllSidebars };

type RunningTurn = {
  conversation: Conversation;
  assistantOutput: string;
  model?: string;
  reasoningEffort?: string;
  backendId?: string;
  providerProfileId?: string;
  runId?: string;
  turnId?: string;
  legacy?: AgentRunResult["legacy"];
  interrupting: boolean;
  interrupted: boolean;
};

type DisplayState =
  | { kind: "closed"; token: number }
  | { kind: "no-reader"; token: number; label: string }
  | {
      kind: "loading";
      token: number;
      reader: _ZoteroTypes.ReaderInstance<"pdf">;
      label: string;
    }
  | {
      kind: "ready";
      token: number;
      reader: _ZoteroTypes.ReaderInstance<"pdf">;
      workspace: WorkspaceIdentity;
      conversation: Conversation;
    }
  | {
      kind: "error";
      token: number;
      reader?: _ZoteroTypes.ReaderInstance<"pdf">;
      label: string;
      message: string;
    };

function registerSidebar(win: _ZoteroTypes.MainWindow): void {
  const existing = controllers.get(win);
  if (existing) {
    existing.refreshContext();
    return;
  }
  const controller = new SidebarController(win);
  controllers.set(win, controller);
  controller.mount();
}

function unregisterSidebar(win: Window): void {
  const controller = controllers.get(win);
  if (!controller) {
    return;
  }
  controller.destroy();
  controllers.delete(win);
}

function unregisterAllSidebars(): void {
  Zotero.getMainWindows().forEach((win) => unregisterSidebar(win));
}

class SidebarController {
  private readonly doc: Document;
  private readonly win: Window;
  private styleNode?: ProcessingInstruction;
  private readonly deckAdapter: ContextPaneDeckAdapter;
  private deckHost?: ZopilotDeckHost;
  private deckHostLoading = false;
  private deckPanel?: HTMLElement;
  private open = false;
  private destroyed = false;
  private modelLoadPromise?: Promise<void>;
  private selectionToken = 0;
  private displayState: DisplayState = { kind: "closed", token: 0 };
  private viewState: SidebarState;
  private readonly readerToolbar: ReaderToolbarController;
  private readonly sessions: SidebarSessionCoordinator;
  private readonly sourceUniverse: ZoteroSourceUniverse;
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly listeners: Array<() => void> = [];
  private pdfHelperNotice?: {
    conversationId: string;
    message: SidebarMessageView;
  };

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    this.sourceUniverse = new ZoteroSourceUniverse(
      (win as Window & { Zotero?: typeof Zotero }).Zotero || Zotero,
    );
    this.deckAdapter = new ContextPaneDeckAdapter(win, {
      onActiveStateChange: (state) => this.handleDeckStateChange(state),
    });
    const label = getSelectedItemTitle(this.win);
    this.viewState = createInitialSidebarState(label);
    this.viewState.prompts = loadPromptViews();
    this.readerToolbar = new ReaderToolbarController({
      pluginID: config.addonID,
    });
    this.sessions = new SidebarSessionCoordinator({
      getReadyDisplayState: () => this.getReadyDisplayState(),
      getReadyStateForSelectedReader: () =>
        this.getReadyStateForSelectedReader(),
      getViewState: () => this.viewState,
      updateViewState: (patch) => this.updateViewState(patch),
      setReadyConversation: (conversation) =>
        this.setReadyConversation(conversation),
      focusComposer: () => this.focusComposer(),
      interruptConversationTurn: (conversationId) => {
        const runningTurn = this.runningTurns.get(conversationId);
        if (runningTurn) {
          this.interruptRunningTurn(runningTurn);
        }
      },
      isDestroyed: () => this.destroyed,
      isOpen: () => this.open,
    });
  }

  mount(): void {
    this.injectStylesheet();
    this.readerToolbar.mount();
    this.deckAdapter.mount();
    this.ensureMountedSurfaces();
    this.bindContextRefresh();
    this.bindLayoutRefresh();
    this.bindPromptRefresh();
    this.bindBackendProfileRefresh();
    this.bindSelectionCopy();
    this.bindSessionPopoverDismiss();
    this.refreshContext();
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.splice(0).forEach((dispose) => dispose());
    this.deckHost?.destroy();
    this.deckHost = undefined;
    this.deckPanel = undefined;
    this.deckAdapter.destroy();
    this.styleNode?.remove();
    this.readerToolbar.destroy();
  }

  refreshContext(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.open) {
      if (isPDFReader(reader)) {
        const token = ++this.selectionToken;
        void this.loadReaderConversation(reader, token);
      } else {
        void this.syncWithSelectedPDFReader();
      }
      return;
    }
    this.displayState = { kind: "closed", token: this.selectionToken };
    this.renderDisplayState();
  }

  private injectStylesheet(): void {
    if (hasStylesheet(this.doc, STYLE_URI)) {
      return;
    }
    this.styleNode = this.doc.createProcessingInstruction(
      "xml-stylesheet",
      `href="${STYLE_URI}" type="text/css"`,
    );
    this.doc.insertBefore(this.styleNode, this.doc.documentElement);
  }

  private ensureMountedSurfaces(): void {
    this.deckAdapter.mount();
    if (this.open) {
      this.attachPanel();
    }
    this.readerToolbar.refresh();
  }

  private openZopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    const token = ++this.selectionToken;
    this.ensureNativeContextPaneVisible(reader);
    this.setOpen(true);
    if (isPDFReader(reader)) {
      void this.loadReaderConversation(reader, token);
      return;
    }
    const selectedReader = getSelectedPDFReader(this.win);
    if (selectedReader) {
      this.ensureNativeContextPaneVisible(selectedReader);
      void this.loadReaderConversation(selectedReader, token);
      return;
    }
    this.setDisplayState({
      kind: "no-reader",
      token,
      label: getSelectedItemTitle(this.win),
    });
    void this.loadSelectedReader(token);
  }

  private queueBackendStatusCheck(): void {
    this.win.setTimeout(() => {
      if (!this.destroyed) {
        void this.loadModels();
      }
    }, 0);
  }

  private async loadSelectedReader(token: number): Promise<void> {
    const reader = await getSelectedPDFReaderAsync(this.win);
    if (!this.canCommitSelection(token)) {
      return;
    }
    if (!reader) {
      this.setOpen(false);
      return;
    }
    await this.loadReaderConversation(reader, token);
  }

  private async loadReaderConversation(
    reader: _ZoteroTypes.ReaderInstance<"pdf">,
    token: number,
  ): Promise<void> {
    if (!this.canCommitSelection(token)) {
      return;
    }

    this.attachPanel();
    this.setDisplayState({
      kind: "loading",
      token,
      reader,
      label: getSelectedItemTitle(this.win, reader),
    });

    const gateway = new ZoteroContextGateway(this.win);
    const scope = await gateway.getActivePaper(reader);
    if (!this.canCommitSelection(token)) {
      return;
    }
    const paper = scope ? createPaperIdentity(scope) : null;
    const workspace = paper ? createItemWorkspaceIdentity(paper) : null;
    if (!workspace) {
      this.setDisplayState({
        kind: "error",
        token,
        reader,
        label: getSelectedItemTitle(this.win, reader),
        message: getString("sidebar-unavailable-message"),
      });
      return;
    }

    try {
      await this.loadWorkspaceConversation({
        token,
        reader,
        workspace,
        currentSource: paper,
      });
    } catch (error) {
      if (!this.canCommitSelection(token)) {
        return;
      }
      logger.error("failed to load active conversation", error, {
        workspaceKey: workspace.workspaceKey,
        attachmentKey: workspace.defaultSource?.attachmentKey,
      });
      this.setDisplayState({
        kind: "error",
        token,
        reader,
        label: workspace.workspaceLabel,
        message: formatBackendError(error),
      });
    }
  }

  private async loadWorkspaceConversation(input: {
    token: number;
    reader: _ZoteroTypes.ReaderInstance<"pdf">;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity | null;
  }): Promise<void> {
    const conversation =
      await getConversationStore().getOrCreateLatestWorkspaceConversation(
        input.workspace,
      );
    if (!this.canCommitSelection(input.token)) {
      return;
    }
    this.setDisplayState({
      kind: "ready",
      token: input.token,
      reader: input.reader,
      workspace: input.workspace,
      conversation,
    });
    this.updateViewState({ sourceCandidates: [] });

    try {
      const snapshot = await this.sourceUniverse.getSnapshot({
        workspace: input.workspace,
        currentSource: input.currentSource || input.workspace.defaultSource,
      });
      if (!this.canCommitSelection(input.token)) {
        return;
      }
      this.setDisplayState({
        kind: "ready",
        token: input.token,
        reader: input.reader,
        workspace: snapshot.workspace,
        conversation,
      });
      this.updateViewState({
        sourceCandidates: snapshot.sources,
        collectionOptions: snapshot.collections,
      });
    } catch (error) {
      logger.warn("failed to refresh workspace source universe", {
        error,
        workspaceKey: input.workspace.workspaceKey,
      });
      if (this.canCommitSelection(input.token)) {
        this.updateViewState({ sourceCandidates: [] });
      }
    }
  }

  private mountPanel(): void {
    const panel = this.deckAdapter.ensurePanel();
    if (!panel) {
      const unavailable = this.deckAdapter.getUnavailableResult();
      logger.warn("failed to mount Zopilot context pane deck", unavailable);
      this.setOpen(false);
      return;
    }
    this.deckPanel = panel;
    void this.ensureDeckHost(panel);
  }

  private ensureDeckHost(panel: HTMLElement): void {
    if (this.deckHost || this.deckHostLoading) {
      return;
    }

    this.deckHostLoading = true;
    void this.createDeckHost(panel);
  }

  private async createDeckHost(panel: HTMLElement): Promise<void> {
    let failed = false;
    try {
      if (this.destroyed || this.deckPanel !== panel) {
        return;
      }
      const deckHost = await createZopilotDeckHost(panel);
      if (this.destroyed || this.deckPanel !== panel) {
        deckHost.destroy();
        return;
      }
      this.deckHost = deckHost;
      this.renderApp();
    } catch (error) {
      failed = true;
      logger.error("failed to mount Zopilot React deck", error);
    } finally {
      this.deckHostLoading = false;
      if (!failed && this.open && !this.deckHost && this.deckPanel) {
        this.ensureDeckHost(this.deckPanel);
      }
    }
  }

  private async submitPromptAsync(
    submission: SidebarPromptSubmission,
  ): Promise<void> {
    const promptText = submission.text.trim();
    if (!promptText) {
      return;
    }

    const ready = await this.getReadyStateForSelectedReader();
    if (!ready) {
      return;
    }
    let conversation = ready.conversation;
    if (this.runningTurns.has(conversation.metadata.id)) {
      return;
    }
    if (!(await this.ensurePdfHelperCurrentForPrompt(conversation))) {
      return;
    }
    this.clearPdfHelperNotice(conversation.metadata.id);

    conversation = await getConversationStore().addMessage(
      conversation.metadata,
      {
        role: "user",
        text: promptText,
        mentions: submission.mentions,
        localAttachments: submission.localAttachments,
      },
    );
    this.setReadyConversation(conversation);
    const runningTurn: RunningTurn = {
      conversation,
      assistantOutput: "",
      model: this.viewState.selectedModel,
      reasoningEffort: this.viewState.selectedReasoningEffort,
      providerProfileId: this.viewState.selectedProviderId,
      interrupting: false,
      interrupted: false,
    };
    this.runningTurns.set(conversation.metadata.id, runningTurn);
    this.renderDisplayState();

    try {
      let pendingToolBoundary = false;
      const result = await getAgentBackendManager().sendPrompt(
        {
          providerProfileId: runningTurn.providerProfileId,
          conversation,
          prompt: promptText,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
          mentions: submission.mentions,
          localAttachments: submission.localAttachments,
        },
        {
          onRunStarted: (event) => {
            runningTurn.backendId = event.backendId;
            runningTurn.providerProfileId = event.providerProfileId;
            runningTurn.runId = event.runId;
            runningTurn.turnId = event.turnId;
            runningTurn.legacy = event.legacy;
            if (runningTurn.interrupting) {
              this.interruptRunningTurn(runningTurn);
            }
          },
          onTextDelta: (delta: string) => {
            if (runningTurn.interrupted) {
              return;
            }
            if (
              pendingToolBoundary &&
              runningTurn.assistantOutput.trim() &&
              delta.trim()
            ) {
              runningTurn.assistantOutput += TOOL_OUTPUT_SEPARATOR;
              pendingToolBoundary = false;
            }
            runningTurn.assistantOutput += delta;
            this.refreshRunningTurnView(runningTurn);
          },
          onToolStarted: () => {
            if (runningTurn.assistantOutput.trim()) {
              pendingToolBoundary = true;
            }
          },
          onNotice: (notice) => {
            if (!runningTurn.assistantOutput && !runningTurn.interrupted) {
              runningTurn.assistantOutput = notice;
              this.refreshRunningTurnView(runningTurn);
            }
          },
        },
      );
      runningTurn.backendId = result.backendId;
      runningTurn.providerProfileId = result.providerProfileId;
      runningTurn.runId = result.runId;
      runningTurn.turnId = result.turnId;
      runningTurn.legacy = result.legacy;
      this.updateViewState({
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
      });
      const finalText =
        runningTurn.assistantOutput ||
        result.text ||
        getString("sidebar-backend-empty-response");
      const metadata = await getConversationStore().updateBackendMetadata(
        conversation.metadata,
        {
          backendId: result.backendId,
          providerProfileId: result.providerProfileId,
          codexThreadId: result.legacy?.codexThreadId,
        },
      );
      const completedProfile =
        getProviderProfileStore().getProfile(result.providerProfileId) ||
        getAgentBackendManager().getActiveProfile();
      conversation = await getConversationStore().addMessage(metadata, {
        role: "assistant",
        text: finalText,
        status:
          result.status === "interrupted" || runningTurn.interrupted
            ? "interrupted"
            : "complete",
        completedAt: new Date().toISOString(),
        codexThreadId: result.legacy?.codexThreadId,
        codexTurnId: result.legacy?.codexTurnId,
        backendId: result.backendId,
        backendKind: completedProfile.kind,
        providerProfileId: result.providerProfileId,
        backendRunId: result.runId,
        backendTurnId: result.turnId,
        capabilitySnapshot: completedProfile.capabilities,
        model: runningTurn.model,
        reasoningEffort: runningTurn.reasoningEffort,
      });
      this.finishRunningTurn(runningTurn, conversation);
    } catch (error) {
      logger.error("agent backend sendPrompt failed", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
        runId: runningTurn.runId,
        turnId: runningTurn.turnId,
      });
      await this.showBackendDiagnostic(error);
      const errorText = formatBackendError(error);
      const text = runningTurn.interrupted
        ? runningTurn.assistantOutput || getString("sidebar-status-interrupted")
        : errorText;
      const failedProfile = runningTurn.providerProfileId
        ? getProviderProfileStore().getProfile(runningTurn.providerProfileId)
        : undefined;
      conversation = await getConversationStore().addMessage(
        conversation.metadata,
        {
          role: "assistant",
          text,
          status: runningTurn.interrupted ? "interrupted" : "error",
          completedAt: new Date().toISOString(),
          backendId: runningTurn.backendId,
          backendKind:
            failedProfile?.kind ||
            getAgentBackendManager().getActiveProfile().kind,
          providerProfileId: runningTurn.providerProfileId,
          backendRunId: runningTurn.runId,
          backendTurnId: runningTurn.turnId,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
        },
      );
      this.finishRunningTurn(runningTurn, conversation);
    } finally {
      this.updateRunningState();
    }
  }

  private refreshRunningTurnView(runningTurn: RunningTurn): void {
    if (
      this.getReadyDisplayState()?.conversation.metadata.id !==
      runningTurn.conversation.metadata.id
    ) {
      return;
    }
    this.renderDisplayState();
  }

  private async ensurePdfHelperCurrentForPrompt(
    conversation: Conversation,
  ): Promise<boolean> {
    let status: PdfHelperStatus;
    try {
      status = await getPdfHelperStatus();
    } catch (error) {
      logger.error("failed to check pdf helper before prompt", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      this.setPdfHelperNotice(
        conversation.metadata.id,
        getString("sidebar-pdf-helper-check-failed"),
      );
      return false;
    }
    if (isPdfHelperCurrentForPrompt(status)) {
      return true;
    }
    this.setPdfHelperNotice(
      conversation.metadata.id,
      createPdfHelperNoticeText(status),
    );
    return false;
  }

  private setPdfHelperNotice(conversationId: string, text: string): void {
    this.pdfHelperNotice = {
      conversationId,
      message: {
        id: `zp-pdf-helper-notice-${conversationId}`,
        role: "assistant",
        text,
        status: "error",
        transient: true,
      },
    };
    this.renderDisplayState();
  }

  private clearPdfHelperNotice(conversationId: string): void {
    if (this.pdfHelperNotice?.conversationId === conversationId) {
      this.pdfHelperNotice = undefined;
      this.renderDisplayState();
    }
  }

  private finishRunningTurn(
    runningTurn: RunningTurn,
    conversation: Conversation,
  ): void {
    const conversationId = runningTurn.conversation.metadata.id;
    this.runningTurns.delete(conversationId);
    if (
      this.getReadyDisplayState()?.conversation.metadata.id === conversationId
    ) {
      this.setReadyConversation(conversation);
    }
    if (this.viewState.sessionsOpen) {
      void this.sessions.showPopover();
    }
  }

  private interruptActiveTurn(): void {
    const conversationId =
      this.getReadyDisplayState()?.conversation.metadata.id;
    const runningTurn = conversationId
      ? this.runningTurns.get(conversationId)
      : undefined;
    if (!runningTurn) {
      return;
    }
    this.interruptRunningTurn(runningTurn);
  }

  private interruptRunningTurn(runningTurn: RunningTurn): void {
    runningTurn.interrupting = true;
    runningTurn.interrupted = true;
    this.refreshRunningTurnView(runningTurn);
    this.updateRunningState();
    const { runId, turnId, legacy } = runningTurn;
    if (!runId && !legacy?.codexThreadId) {
      return;
    }
    void getAgentBackendManager()
      .cancelTurn({
        conversationId: runningTurn.conversation.metadata.id,
        providerProfileId: runningTurn.providerProfileId,
        runId,
        turnId,
        legacy,
      })
      .catch((error) => {
        logger.error("agent backend cancel failed", error, {
          runId,
          turnId,
          conversationId: runningTurn.conversation.metadata.id,
        });
      });
  }

  private async loadModels(): Promise<void> {
    if (this.modelLoadPromise) {
      return this.modelLoadPromise;
    }
    this.modelLoadPromise = this.loadModelsOnce().finally(() => {
      this.modelLoadPromise = undefined;
    });
    return this.modelLoadPromise;
  }

  private async loadModelsOnce(): Promise<void> {
    this.updateViewState({
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
      if (this.destroyed) {
        return;
      }
      const availableModels = providerModels.flatMap(({ profile, models }) =>
        models.map((model) => agentModelToSidebarModel(model, profile)),
      );
      if (!availableModels.length) {
        this.updateModelSelection(
          [DEFAULT_MODEL],
          DEFAULT_MODEL.providerProfileId,
          DEFAULT_MODEL.slug,
        );
        await this.showBackendDiagnostic();
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
      this.updateViewState({
        backendStatus: "connected",
        backendDiagnosticMessage: undefined,
        activeProviderLabel: selected.providerLabel,
      });
    } catch (error) {
      logger.error("agent backend model list failed", error);
      if (this.destroyed) {
        return;
      }
      this.updateModelSelection(
        [DEFAULT_MODEL],
        DEFAULT_MODEL.providerProfileId,
        DEFAULT_MODEL.slug,
      );
      await this.showBackendDiagnostic(error);
    }
  }

  private async showBackendDiagnostic(error?: unknown): Promise<void> {
    this.updateViewState({
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
    if (this.destroyed) {
      return;
    }
    this.updateViewState({
      backendStatus: "disconnected",
      backendDiagnosticMessage:
        diagnostic?.message ||
        (error instanceof Error ? error.message : undefined) ||
        getString("sidebar-backend-status-disconnected"),
    });
  }

  private selectModel(value: string): void {
    const { providerProfileId, model } = parseModelSelectValue(value);
    const selected = this.viewState.models.find(
      (item) =>
        item.providerProfileId === providerProfileId && item.slug === model,
    );
    if (!selected) {
      return;
    }
    const manager = getAgentBackendManager();
    const active = getProviderProfileStore().getProfile(providerProfileId);
    this.saveSelectedModel(providerProfileId, model);
    manager.setActiveProvider(providerProfileId);
    if (active?.kind === "codex-cli") {
      setPref("codex.model", model);
    }
    this.updateModelSelection(this.viewState.models, providerProfileId, model);
    this.updateViewState({ activeProviderLabel: selected.providerLabel });
  }

  private selectReasoningEffort(effort: string): void {
    const efforts = getReasoningEffortsForModel(
      this.viewState.selectedProviderId,
      this.viewState.selectedModel,
      this.viewState.models,
    );
    if (!efforts.includes(effort)) {
      return;
    }
    const saved = this.readSavedReasoningEfforts();
    saved[
      createReasoningPreferenceKey(
        this.viewState.selectedProviderId,
        this.viewState.selectedModel,
      )
    ] = effort;
    setPref("codex.reasoningEfforts", JSON.stringify(saved));
    this.updateViewState({ selectedReasoningEffort: effort });
  }

  private async selectWorkspaceMode(type: WorkspaceType): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready || ready.workspace.workspaceType === type) {
      return;
    }
    const token = ++this.selectionToken;
    const currentSource = ready.workspace.defaultSource;
    let workspace: WorkspaceIdentity | null = null;
    if (type === "library") {
      workspace = await this.sourceUniverse.createLibraryWorkspace({
        libraryID: ready.workspace.libraryID,
        currentSource,
      });
    } else if (type === "collection") {
      const collectionKey =
        this.viewState.collectionOptions[0]?.key ||
        ready.workspace.collectionKey;
      workspace = collectionKey
        ? await this.sourceUniverse.createCollectionWorkspace({
            libraryID: ready.workspace.libraryID,
            collectionKey,
            currentSource,
          })
        : null;
    } else {
      const source = this.findSourceForItemMode(currentSource);
      workspace = source
        ? await this.sourceUniverse.createItemWorkspace(source)
        : currentSource
          ? createItemWorkspaceIdentity(currentSource)
          : null;
    }
    if (!workspace) {
      return;
    }
    await this.loadWorkspaceConversation({
      token,
      reader: ready.reader,
      workspace,
      currentSource,
    });
  }

  private async selectCollectionWorkspace(
    collectionKey: string,
  ): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (
      !ready ||
      (ready.workspace.workspaceType === "collection" &&
        ready.workspace.collectionKey === collectionKey)
    ) {
      return;
    }
    const token = ++this.selectionToken;
    const workspace = await this.sourceUniverse.createCollectionWorkspace({
      libraryID: ready.workspace.libraryID,
      collectionKey,
      currentSource: ready.workspace.defaultSource,
    });
    if (!workspace) {
      return;
    }
    await this.loadWorkspaceConversation({
      token,
      reader: ready.reader,
      workspace,
      currentSource: ready.workspace.defaultSource,
    });
  }

  private async selectItemWorkspace(sourceId: string): Promise<void> {
    const ready = this.getReadyDisplayState();
    const source = this.viewState.sourceCandidates.find(
      (item) => item.sourceId === sourceId,
    );
    if (!ready || !source) {
      return;
    }
    const token = ++this.selectionToken;
    const workspace = await this.sourceUniverse.createItemWorkspace(source);
    await this.loadWorkspaceConversation({
      token,
      reader: ready.reader,
      workspace,
      currentSource: paperSourceRefToIdentity(source),
    });
  }

  private async uploadAttachment(): Promise<LocalAttachmentRef | undefined> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return undefined;
    }
    try {
      const result = await pickLocalAttachment({
        win: this.win,
      });
      return result.status === "selected" ? result.attachment : undefined;
    } catch (error) {
      logger.error("failed to choose local attachment", error, {
        workspaceKey: ready.workspace.workspaceKey,
      });
      return undefined;
    }
  }

  private async openReaderLocator(locator: ReaderLocator): Promise<void> {
    const ready = this.getReadyDisplayState();
    const itemID = ready?.workspace.defaultSource?.attachmentItemID;
    try {
      await navigateReaderLocator(this.win, locator, {
        itemID,
        reader: ready?.reader,
      });
    } catch (error) {
      logger.error("failed to navigate Zotero reader locator", error, {
        locator,
        itemID,
      });
    }
  }

  private findSourceForItemMode(
    currentSource?: PaperIdentity,
  ): PaperSourceRef | undefined {
    const currentSourceId = currentSource
      ? `${currentSource.libraryID}-${currentSource.attachmentKey}`
      : "";
    return (
      this.viewState.sourceCandidates.find(
        (source) => source.sourceId === currentSourceId,
      ) || this.viewState.sourceCandidates[0]
    );
  }

  private updateModelSelection(
    models: SidebarState["models"],
    selectedProviderId: string,
    selectedModel: string,
  ): void {
    this.updateViewState(
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
    return (
      resolveSelectedModel({
        models,
        activeProviderId,
        currentProviderId: this.viewState.selectedProviderId,
        currentModel: this.viewState.selectedModel,
        savedSelectedModels: this.readSavedSelectedModels(),
      }) || models[0]
    );
  }

  private readSavedReasoningEfforts(): Record<string, string> {
    return parseSavedReasoningEfforts(getPref("codex.reasoningEfforts"));
  }

  private readSavedSelectedModels(): Record<string, string> {
    const saved = parseSavedSelectedModels(getPref(SELECTED_MODELS_PREF));
    const legacyCodexModel = String(getPref("codex.model") || "").trim();
    if (legacyCodexModel) {
      saved[DEFAULT_MODEL.providerProfileId] = legacyCodexModel;
    }
    return saved;
  }

  private saveSelectedModel(providerProfileId: string, model: string): void {
    const saved = this.readSavedSelectedModels();
    saved[providerProfileId] = model;
    setPref(SELECTED_MODELS_PREF, JSON.stringify(saved));
  }

  private updateRunningState(): void {
    const conversationId =
      this.getReadyDisplayState()?.conversation.metadata.id;
    const runningTurn = conversationId
      ? this.runningTurns.get(conversationId)
      : undefined;
    this.updateViewState({
      busy: Boolean(runningTurn),
    });
  }

  private getReadyDisplayState():
    | Extract<DisplayState, { kind: "ready" }>
    | undefined {
    return this.displayState.kind === "ready" ? this.displayState : undefined;
  }

  private async getReadyStateForSelectedReader(): Promise<
    Extract<DisplayState, { kind: "ready" }> | undefined
  > {
    const selectedReader = getSelectedPDFReader(this.win);
    const ready = this.getReadyDisplayState();
    if (selectedReader && ready && this.isCurrentReader(selectedReader)) {
      return ready;
    }

    const token = ++this.selectionToken;
    if (selectedReader) {
      await this.loadReaderConversation(selectedReader, token);
      return this.getReadyDisplayState();
    }

    await this.loadSelectedReader(token);
    return this.getReadyDisplayState();
  }

  private setReadyConversation(conversation: Conversation): void {
    const ready = this.getReadyDisplayState();
    if (
      !ready ||
      ready.workspace.workspaceKey !== conversation.metadata.workspaceKey
    ) {
      return;
    }
    this.setDisplayState({ ...ready, conversation });
  }

  private setDisplayState(displayState: DisplayState): void {
    this.displayState = displayState;
    this.renderDisplayState();
    this.readerToolbar.refresh();
  }

  private renderDisplayState(): void {
    const state = this.displayState;
    if (state.kind === "ready") {
      const runningTurn = this.runningTurns.get(state.conversation.metadata.id);
      const source = state.workspace.defaultSource;
      const messages = createConversationMessages(
        state.conversation,
        runningTurn
          ? {
              text: runningTurn.assistantOutput,
              interrupted: runningTurn.interrupted,
              running: !runningTurn.interrupted,
            }
          : undefined,
      );
      const pdfHelperNotice =
        this.pdfHelperNotice?.conversationId === state.conversation.metadata.id
          ? this.pdfHelperNotice.message
          : undefined;
      this.updateViewState({
        title: `${state.conversation.metadata.workspaceTitle} / ${state.conversation.metadata.label}`,
        context: {
          label: state.workspace.workspaceLabel,
          workspaceKey: state.workspace.workspaceKey,
          workspaceType: state.workspace.workspaceType,
          collectionKey: state.workspace.collectionKey,
          itemKey: state.workspace.itemKey,
          paperTitle: source?.title,
          paperKey: source?.paperKey,
          parentItemKey: source?.parentItemKey,
          attachmentKey: source?.attachmentKey,
        },
        composerEnabled: true,
        messages: pdfHelperNotice ? [...messages, pdfHelperNotice] : messages,
        busy: Boolean(runningTurn),
        prompts: loadPromptViews(),
        sessions: this.viewState.sessions.map((session) =>
          createSessionView(
            session.conversation,
            state.conversation.metadata.id,
          ),
        ),
      });
      return;
    }

    const label =
      state.kind === "closed"
        ? getSelectedItemTitle(this.win, getSelectedPDFReader(this.win))
        : state.label;
    const message =
      state.kind === "loading"
        ? getString("sidebar-loading-conversation")
        : state.kind === "error"
          ? state.message
          : getString("sidebar-unavailable-message");
    this.updateViewState({
      title: label,
      context: { label },
      composerEnabled: false,
      busy: false,
      sessionsOpen: false,
      sessions: [],
      sourceCandidates: [],
      collectionOptions: [],
      prompts: loadPromptViews(),
      messages: [
        {
          id: `zp-status-${state.token}`,
          role: "assistant",
          text: message,
          status: "complete",
          transient: true,
        },
      ],
    });
  }

  private canCommitSelection(token: number): boolean {
    return !this.destroyed && this.open && token === this.selectionToken;
  }

  private setOpen(open: boolean): void {
    const wasOpen = this.open;
    this.open = open;
    if (open) {
      this.attachPanel();
    } else {
      this.closeZopilotPane({ restoreItemPane: true });
      return;
    }
    this.readerToolbar.refresh();
    this.renderDisplayState();
    this.win.requestAnimationFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });

    if (open) {
      if (!wasOpen) {
        this.queueBackendStatusCheck();
      }
      this.focusComposer();
    }
  }

  private closeZopilotPane(options: { restoreItemPane?: boolean } = {}): void {
    this.open = false;
    this.selectionToken++;
    this.displayState = { kind: "closed", token: this.selectionToken };
    this.sessions.hidePopover();
    this.updateViewState({ busy: false, composerEnabled: false });
    this.deckHost?.destroy();
    this.deckHost = undefined;
    this.deckPanel = undefined;
    if (options.restoreItemPane) {
      this.deckAdapter.select("item");
    }
    this.readerToolbar.refresh();
    this.renderDisplayState();
    this.win.requestAnimationFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });
  }

  private attachPanel(): void {
    this.ensureNativeContextPaneVisible();
    this.mountPanel();
    this.deckAdapter.select("zopilot");
  }

  private ensureNativeContextPaneVisible(
    reader?: _ZoteroTypes.ReaderInstance,
  ): void {
    const contextPane = this.doc.getElementById("zotero-context-pane");
    if (isElementVisible(contextPane)) {
      return;
    }
    const readerWin = reader?._iframeWindow;
    const toggle = readerWin?.document?.querySelector(
      ".toolbar .end .context-pane-toggle",
    );
    if (!readerWin || !toggle) {
      return;
    }
    if (toggle instanceof readerWin.HTMLElement) {
      (toggle as HTMLElement).click();
    }
  }

  private focusComposer(): void {
    this.win.requestAnimationFrame(() => {
      this.updateViewState({ focusToken: this.viewState.focusToken + 1 });
    });
  }

  private handleDeckStateChange(state: ContextPaneActiveState): void {
    if (this.destroyed) {
      return;
    }
    if (state === "zopilot") {
      if (!this.open) {
        this.openZopilotPane();
      }
      return;
    }
    if (this.open) {
      this.closeZopilotPane();
    }
  }

  private isCurrentReader(reader: _ZoteroTypes.ReaderInstance): boolean {
    const state = this.displayState;
    if (
      (state.kind === "loading" ||
        state.kind === "ready" ||
        state.kind === "error") &&
      state.reader?.itemID === reader.itemID
    ) {
      return true;
    }
    return (
      state.kind === "ready" &&
      reader.itemID !== undefined &&
      Zotero.Items.get(reader.itemID)?.key ===
        state.workspace.defaultSource?.attachmentKey
    );
  }

  private bindContextRefresh(): void {
    const pane = this.doc.getElementById("zotero-pane");
    const itemTree = this.doc.getElementById("zotero-items-tree");
    const refreshSoon = () => {
      this.win.setTimeout(() => {
        this.syncWithSelectedPDFReader();
      }, 0);
    };

    for (const target of [pane, itemTree]) {
      if (!target) {
        continue;
      }
      target.addEventListener("click", refreshSoon);
      target.addEventListener("keyup", refreshSoon);
      this.listeners.push(() => {
        target.removeEventListener("click", refreshSoon);
        target.removeEventListener("keyup", refreshSoon);
      });
    }
  }

  private bindLayoutRefresh(): void {
    const refreshLayoutSoon = () => {
      this.win.setTimeout(() => {
        this.ensureMountedSurfaces();
        if (!this.open) {
          this.refreshContext();
        }
      }, 0);
    };
    const reloadConversationSoon = () => {
      this.win.setTimeout(() => {
        this.syncWithSelectedPDFReader();
      }, 0);
    };

    const observer = new this.win.MutationObserver(refreshLayoutSoon);
    observer.observe(this.doc.documentElement, {
      childList: true,
      subtree: true,
    });
    this.listeners.push(() => observer.disconnect());

    this.win.addEventListener("focus", reloadConversationSoon);
    this.win.addEventListener("resize", refreshLayoutSoon);
    this.listeners.push(() => {
      this.win.removeEventListener("focus", reloadConversationSoon);
      this.win.removeEventListener("resize", refreshLayoutSoon);
    });

    const tabContainer = this.doc.getElementById("tabbrowser-tabs");
    tabContainer?.addEventListener("TabSelect", reloadConversationSoon);
    if (tabContainer) {
      this.listeners.push(() => {
        tabContainer.removeEventListener("TabSelect", reloadConversationSoon);
      });
    }
  }

  private bindPromptRefresh(): void {
    this.listeners.push(
      subscribePromptViews((prompts) => {
        if (!this.destroyed) {
          this.updateViewState({ prompts });
        }
      }),
    );
  }

  private bindBackendProfileRefresh(): void {
    this.listeners.push(
      getAgentBackendManager().subscribe((snapshot) => {
        const active = snapshot.profiles.find(
          (profile) => profile.id === snapshot.activeProviderId,
        );
        if (!active || this.destroyed) {
          return;
        }
        this.updateViewState({
          activeProviderLabel: active.displayName,
        });
        if (this.open) {
          void this.loadModels();
        }
      }),
    );
  }

  private async syncWithSelectedPDFReader(): Promise<void> {
    const selectedReader = getSelectedPDFReader(this.win);
    if (!selectedReader) {
      const token = ++this.selectionToken;
      if (this.open) {
        await this.loadSelectedReader(token);
      } else {
        this.setDisplayState({
          kind: "no-reader",
          token,
          label: getSelectedItemTitle(this.win),
        });
        this.readerToolbar.refresh();
      }
      return;
    }

    if (this.open) {
      if (
        this.isCurrentReader(selectedReader) &&
        this.displayState.kind === "ready"
      ) {
        this.readerToolbar.refresh();
        return;
      }
      const token = ++this.selectionToken;
      await this.loadReaderConversation(selectedReader, token);
    } else {
      const token = ++this.selectionToken;
      this.displayState = { kind: "closed", token };
      this.renderDisplayState();
    }
    this.readerToolbar.refresh();
  }

  private bindSessionPopoverDismiss(): void {
    const dismiss = (event: Event) => {
      if (!this.viewState.sessionsOpen) {
        return;
      }
      const target = event.target as Node | null;
      if (target && this.deckPanel?.contains(target)) {
        return;
      }
      this.sessions.hidePopover();
    };
    this.doc.addEventListener("click", dismiss);
    this.listeners.push(() => this.doc.removeEventListener("click", dismiss));
  }

  private bindSelectionCopy(): void {
    const copySelection = (event: ClipboardEvent) => {
      const text = getSidebarSelectionText(this.win, this.deckPanel);
      if (!text) {
        return;
      }

      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      void copyText(text, this.win);
    };
    this.doc.addEventListener("copy", copySelection, true);
    this.listeners.push(() =>
      this.doc.removeEventListener("copy", copySelection, true),
    );
  }

  private updateViewState(patch: Partial<SidebarState>): void {
    this.viewState = {
      ...this.viewState,
      ...patch,
    };
    this.renderApp();
  }

  private renderApp(): void {
    this.deckHost?.render(this.viewState, {
      archiveSession: (conversation) => {
        void this.sessions.archiveSession(conversation);
      },
      close: () => this.setOpen(false),
      createNewSession: () => {
        void this.sessions.createNewSession();
      },
      hideSessions: () => this.sessions.hidePopover(),
      interruptActiveTurn: () => this.interruptActiveTurn(),
      openExternalLink: (url) => {
        if (isSafeExternalURL(url, this.win)) {
          Zotero.launchURL(url);
        }
      },
      openReaderLocator: (locator) => {
        void this.openReaderLocator(locator);
      },
      selectModel: (model) => this.selectModel(model),
      selectReasoningEffort: (effort) => this.selectReasoningEffort(effort),
      selectWorkspaceMode: (type) => {
        void this.selectWorkspaceMode(type);
      },
      selectCollectionWorkspace: (collectionKey) => {
        void this.selectCollectionWorkspace(collectionKey);
      },
      selectItemWorkspace: (sourceId) => {
        void this.selectItemWorkspace(sourceId);
      },
      submitPrompt: (submission) => {
        void this.submitPromptAsync(submission);
      },
      uploadAttachment: () => this.uploadAttachment(),
      switchSession: (conversation) => {
        void this.sessions.switchSession(conversation);
      },
      restoreSession: (conversation) => {
        void this.sessions.restoreSession(conversation);
      },
      toggleArchivedSessions: () => {
        void this.sessions.togglePopover("archive");
      },
      toggleSessions: () => {
        void this.sessions.togglePopover("history");
      },
    });
  }
}

const __sidebarControllerTestHooks = {
  SidebarController,
  createPdfHelperNoticeText,
  getSidebarSelectionText,
};

function getSidebarSelectionText(win: Window, root?: Node): string {
  const selection = win.getSelection();
  if (
    !root ||
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return "";
  }
  return selection.toString();
}

function hasStylesheet(doc: Document, uri: string): boolean {
  return Array.from(doc.childNodes).some((node) => {
    return (
      node !== null && node.nodeType === 7 && node.nodeValue?.includes(uri)
    );
  });
}

function isElementVisible(element: Element | null): boolean {
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

function formatBackendError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [getString("sidebar-backend-error"), "", "```", message, "```"].join(
    "\n",
  );
}

function agentModelToSidebarModel(
  model: {
    id: string;
    displayName: string;
    supportedReasoningEfforts: string[];
    defaultReasoningEffort?: string;
  },
  profile: ProviderProfile,
): SidebarState["models"][number] {
  return {
    slug: model.id,
    displayName: model.displayName,
    providerProfileId: profile.id,
    providerLabel: profile.displayName,
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

function isSafeExternalURL(url: string, win: Window): boolean {
  try {
    const parsed = new win.URL(url);
    return ["https:", "http:", "mailto:", "doi:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export { __sidebarControllerTestHooks };
