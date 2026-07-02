import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
import { getCodexBridge } from "../../codex/bridge";
import {
  diagnoseCodexConnection,
  type CodexDiagnostic,
} from "../../codex/diagnostics";
import type { CodexDiscoverySubprocessModule } from "../../codex/cliDiscovery";
import type {
  Conversation,
  PaperIdentity,
  PaperSourceRef,
  SourceMention,
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
import { pickAndImportAttachment } from "./attachmentUpload";
import { copyText } from "./app/clipboard";
import type { ReaderLocator } from "./readerNavigation";
import { navigateReaderLocator } from "./readerNavigation";
import type {
  SidebarModelView,
  SidebarMode,
  SidebarPromptSubmission,
  SidebarSessionMode,
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
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadPromptViews,
} from "./promptStore";
import {
  loadSkillViews,
  setSkillEnabled as saveSkillEnabled,
} from "./skillRegistry";
import {
  DEFAULT_MODEL,
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
} from "./viewModel";

const controllers = new WeakMap<Window, SidebarController>();
const CODEX_TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";
const logger = createLogger("sidebar.controller");
export { registerSidebar, unregisterSidebar, unregisterAllSidebars };

type RunningTurn = {
  conversation: Conversation;
  assistantOutput: string;
  model?: string;
  mode: SidebarMode;
  reasoningEffort?: string;
  threadId?: string;
  turnId?: string;
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
  private diagnosticSubprocess?: CodexDiscoverySubprocessModule;
  private modelLoadPromise?: Promise<void>;
  private selectionToken = 0;
  private displayState: DisplayState = { kind: "closed", token: 0 };
  private viewState: SidebarState;
  private readonly readerToolbar: ReaderToolbarController;
  private readonly sourceUniverse: ZoteroSourceUniverse;
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly listeners: Array<() => void> = [];

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
    this.viewState.selectedMode = readSavedMode();
    this.viewState.prompts = loadPromptViews();
    this.readerToolbar = new ReaderToolbarController({
      pluginID: config.addonID,
    });
  }

  mount(): void {
    this.injectStylesheet();
    this.readerToolbar.mount();
    this.deckAdapter.mount();
    this.ensureMountedSurfaces();
    this.bindContextRefresh();
    this.bindLayoutRefresh();
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

  private queueCodexStatusCheck(): void {
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
        message: formatCodexError(error),
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

  private async toggleSessionPopover(
    mode: SidebarSessionMode = "history",
  ): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    if (this.viewState.sessionsOpen && this.viewState.sessionsMode === mode) {
      this.hideSessionPopover();
      return;
    }
    await this.showSessionPopover(mode);
  }

  private async showSessionPopover(
    mode: SidebarSessionMode = this.viewState.sessionsMode,
  ): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspaceKey = ready.workspace.workspaceKey;
    let conversations: Conversation[];
    try {
      conversations =
        mode === "archive"
          ? await getConversationStore().listArchivedWorkspaceConversations(
              workspaceKey,
            )
          : await getConversationStore().listWorkspaceConversations(
              workspaceKey,
            );
    } catch (error) {
      logger.error("failed to list workspace conversations", error, {
        workspaceKey,
        mode,
      });
      return;
    }
    if (
      this.destroyed ||
      !this.open ||
      this.getReadyDisplayState()?.workspace.workspaceKey !== workspaceKey
    ) {
      return;
    }
    this.updateViewState({
      sessions: conversations.map((conversation) =>
        createSessionView(
          conversation,
          this.getReadyDisplayState()?.conversation.metadata.id,
        ),
      ),
      sessionsOpen: true,
      sessionsMode: mode,
    });
  }

  private hideSessionPopover(): void {
    if (!this.viewState.sessionsOpen && !this.viewState.sessions.length) {
      return;
    }
    this.updateViewState({ sessionsOpen: false, sessions: [] });
  }

  private async createNewSession(): Promise<void> {
    const ready = await this.getReadyStateForSelectedReader();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    let conversation: Conversation;
    try {
      conversation =
        await getConversationStore().createWorkspaceConversation(workspace);
    } catch (error) {
      logger.error("failed to create workspace conversation", error, {
        workspaceKey: workspace.workspaceKey,
        attachmentKey: workspace.defaultSource?.attachmentKey,
      });
      return;
    }
    this.setReadyConversation(conversation);
    this.hideSessionPopover();
    this.focusComposer();
  }

  private async switchSession(conversation: Conversation): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    let active: Conversation;
    try {
      active = await getConversationStore().activateWorkspaceConversation(
        conversation.metadata,
      );
    } catch (error) {
      logger.error("failed to switch workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (
      this.destroyed ||
      !this.open ||
      this.getReadyDisplayState()?.workspace.workspaceKey !==
        active.metadata.workspaceKey
    ) {
      return;
    }
    this.setReadyConversation(active);
    this.hideSessionPopover();
    this.focusComposer();
  }

  private async archiveSession(conversation: Conversation): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    const running = this.runningTurns.get(conversation.metadata.id);
    if (running) {
      this.interruptRunningTurn(running);
    }
    try {
      await getConversationStore().archiveWorkspaceConversation(
        conversation.metadata,
      );
    } catch (error) {
      logger.error("failed to archive workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (
      this.destroyed ||
      !this.open ||
      this.getReadyDisplayState()?.workspace.workspaceKey !==
        workspace.workspaceKey
    ) {
      return;
    }

    if (
      this.getReadyDisplayState()?.conversation.metadata.id ===
      conversation.metadata.id
    ) {
      let next: Conversation;
      try {
        next =
          (await getConversationStore().getLatestWorkspaceConversation(
            workspace.workspaceKey,
          )) ||
          (await getConversationStore().createWorkspaceConversation(workspace));
      } catch (error) {
        logger.error("failed to select next workspace conversation", error, {
          archivedConversationId: conversation.metadata.id,
          workspaceKey: workspace.workspaceKey,
        });
        return;
      }
      this.setReadyConversation(next);
    }

    await this.showSessionPopover();
  }

  private async restoreSession(conversation: Conversation): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    let restoredMetadata: Conversation["metadata"];
    try {
      restoredMetadata =
        await getConversationStore().restoreWorkspaceConversation(
          conversation.metadata,
        );
    } catch (error) {
      logger.error("failed to restore workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (
      this.destroyed ||
      !this.open ||
      this.getReadyDisplayState()?.workspace.workspaceKey !==
        workspace.workspaceKey
    ) {
      return;
    }

    const current = this.getReadyDisplayState();
    if (current?.conversation.metadata.id === conversation.metadata.id) {
      this.setReadyConversation({
        ...current.conversation,
        metadata: restoredMetadata,
      });
    }

    await this.showSessionPopover("archive");
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

    conversation = await getConversationStore().addMessage(
      conversation.metadata,
      {
        role: "user",
        text: promptText,
        mentions: submission.mentions,
      },
    );
    this.setReadyConversation(conversation);
    const runningTurn: RunningTurn = {
      conversation,
      assistantOutput: "",
      model: this.viewState.selectedModel,
      mode: this.viewState.selectedMode,
      reasoningEffort: this.viewState.selectedReasoningEffort,
      interrupting: false,
      interrupted: false,
    };
    this.runningTurns.set(conversation.metadata.id, runningTurn);
    this.renderDisplayState();

    try {
      const bridge = getCodexBridge();
      let pendingToolBoundary = false;
      const result = await bridge.sendPrompt(
        buildPromptWithMode(
          buildPromptWithSourceRefs(promptText, submission.mentions),
          runningTurn.mode,
        ),
        {
          conversation: conversation.metadata,
          model: runningTurn.model,
          effort: runningTurn.reasoningEffort,
          onTurnStarted: (threadId, turnId) => {
            runningTurn.threadId = threadId;
            runningTurn.turnId = turnId;
            if (runningTurn.interrupting) {
              this.interruptRunningTurn(runningTurn);
            }
          },
          onDelta: (delta) => {
            if (runningTurn.interrupted) {
              return;
            }
            if (
              pendingToolBoundary &&
              runningTurn.assistantOutput.trim() &&
              delta.trim()
            ) {
              runningTurn.assistantOutput += CODEX_TOOL_OUTPUT_SEPARATOR;
              pendingToolBoundary = false;
            }
            runningTurn.assistantOutput += delta;
            this.refreshRunningTurnView(runningTurn);
          },
          onToolActivity: () => {
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
      runningTurn.threadId = result.threadId;
      runningTurn.turnId = result.turnId;
      this.updateViewState({
        codexStatus: "connected",
        codexDiagnostic: undefined,
      });
      const finalText =
        runningTurn.assistantOutput ||
        result.text ||
        getString("sidebar-codex-empty-response");
      const metadata = await getConversationStore().updateCodexThreadId(
        conversation.metadata,
        result.threadId,
      );
      conversation = await getConversationStore().addMessage(metadata, {
        role: "assistant",
        text: finalText,
        status:
          result.status === "interrupted" || runningTurn.interrupted
            ? "interrupted"
            : "complete",
        completedAt: new Date().toISOString(),
        codexThreadId: result.threadId,
        codexTurnId: result.turnId,
        model: runningTurn.model,
        reasoningEffort: runningTurn.reasoningEffort,
      });
      this.finishRunningTurn(runningTurn, conversation);
    } catch (error) {
      logger.error("codex sendPrompt failed", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
        threadId: runningTurn.threadId,
        turnId: runningTurn.turnId,
      });
      await this.showCodexDiagnostic();
      const errorText = formatCodexError(error);
      const text = runningTurn.interrupted
        ? runningTurn.assistantOutput || getString("sidebar-status-interrupted")
        : errorText;
      conversation = await getConversationStore().addMessage(
        conversation.metadata,
        {
          role: "assistant",
          text,
          status: runningTurn.interrupted ? "interrupted" : "error",
          completedAt: new Date().toISOString(),
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
      void this.showSessionPopover();
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
    const { threadId, turnId } = runningTurn;
    if (!threadId || !turnId) {
      return;
    }
    void getCodexBridge()
      .interruptTurn(threadId, turnId)
      .catch((error) => {
        logger.error("codex turn/interrupt failed", error, {
          threadId,
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
      codexStatus: "checking",
      codexDiagnostic: undefined,
    });
    try {
      const models = await getCodexBridge().listModels();
      if (this.destroyed) {
        return;
      }
      const availableModels = models.length ? models : [DEFAULT_MODEL];
      const preferredModel = String(getPref("codex.model") || "");
      const selectedModel = availableModels.some(
        (model) => model.slug === preferredModel,
      )
        ? preferredModel
        : availableModels[0]?.slug || DEFAULT_MODEL.slug;
      this.updateModelSelection(availableModels, selectedModel);
      this.updateViewState({
        codexStatus: "connected",
        codexDiagnostic: undefined,
      });
    } catch (error) {
      logger.error("codex model/list failed", error);
      if (this.destroyed) {
        return;
      }
      this.updateModelSelection([DEFAULT_MODEL], DEFAULT_MODEL.slug);
      await this.showCodexDiagnostic();
    }
  }

  private async showCodexDiagnostic(): Promise<void> {
    this.updateViewState({
      codexStatus: "disconnected",
      codexDiagnostic: undefined,
    });
    let diagnostic: CodexDiagnostic;
    try {
      diagnostic = (await diagnoseCodexConnection(
        this.getDiagnosticSubprocess(),
      )) || {
        code: "unknown_error",
        messageKey: "codex-diagnostic-unknown-error",
      };
    } catch {
      diagnostic = {
        code: "unknown_error",
        messageKey: "codex-diagnostic-unknown-error",
      };
    }
    if (this.destroyed) {
      return;
    }
    this.updateViewState({
      codexStatus: "disconnected",
      codexDiagnostic: diagnostic?.code || "unknown_error",
    });
  }

  private getDiagnosticSubprocess(): CodexDiscoverySubprocessModule {
    if (this.diagnosticSubprocess) {
      return this.diagnosticSubprocess;
    }
    const imported = ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ) as { Subprocess: CodexDiscoverySubprocessModule };
    this.diagnosticSubprocess = imported.Subprocess;
    return this.diagnosticSubprocess;
  }

  private selectModel(model: string): void {
    if (!this.viewState.models.some((item) => item.slug === model)) {
      return;
    }
    setPref("codex.model", model);
    this.updateModelSelection(this.viewState.models, model);
  }

  private selectReasoningEffort(effort: string): void {
    const efforts = this.getReasoningEffortsForModel(
      this.viewState.selectedModel,
      this.viewState.models,
    );
    if (!efforts.includes(effort)) {
      return;
    }
    const saved = this.readSavedReasoningEfforts();
    saved[this.viewState.selectedModel] = effort;
    setPref("codex.reasoningEfforts", JSON.stringify(saved));
    this.updateViewState({ selectedReasoningEffort: effort });
  }

  private selectMode(mode: SidebarMode): void {
    if (mode !== "ask" && mode !== "agent") {
      return;
    }
    setPref("codex.mode", mode);
    this.updateViewState({ selectedMode: mode });
  }

  private createPrompt(input: { title: string; body: string }): void {
    try {
      createCustomPrompt(input);
      this.updateViewState({ prompts: loadPromptViews() });
    } catch (error) {
      logger.warn("failed to create custom prompt", { error: String(error) });
    }
  }

  private deletePrompt(promptId: string): void {
    deleteCustomPrompt(promptId);
    this.updateViewState({ prompts: loadPromptViews() });
  }

  private setSkillEnabled(skillId: string, enabled: boolean): void {
    try {
      saveSkillEnabled(skillId, enabled);
      this.updateViewState({
        skills: this.loadSkillViewsForDisplayState(this.displayState),
      });
    } catch (error) {
      logger.warn("failed to update skill setting", { error: String(error) });
    }
  }

  private async selectWorkspaceMode(type: WorkspaceType): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready || ready.workspace.workspaceType === type) {
      return;
    }
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
      token: ready.token,
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
    const workspace = await this.sourceUniverse.createCollectionWorkspace({
      libraryID: ready.workspace.libraryID,
      collectionKey,
      currentSource: ready.workspace.defaultSource,
    });
    if (!workspace) {
      return;
    }
    await this.loadWorkspaceConversation({
      token: ready.token,
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
    const workspace = await this.sourceUniverse.createItemWorkspace(source);
    await this.loadWorkspaceConversation({
      token: ready.token,
      reader: ready.reader,
      workspace,
      currentSource: paperSourceRefToIdentity(source),
    });
  }

  private async uploadAttachment(): Promise<void> {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return;
    }
    try {
      const result = await pickAndImportAttachment({
        win: this.win,
        libraryID: ready.workspace.libraryID,
        parentItemID: ready.workspace.defaultSource?.parentItemID,
      });
      if (result.status === "imported") {
        await this.loadWorkspaceConversation({
          token: ready.token,
          reader: ready.reader,
          workspace: ready.workspace,
          currentSource: ready.workspace.defaultSource,
        });
      }
    } catch (error) {
      logger.error("failed to upload Zotero attachment", error, {
        workspaceKey: ready.workspace.workspaceKey,
      });
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
    models: SidebarModelView[],
    selectedModel: string,
  ): void {
    const efforts = this.getReasoningEffortsForModel(selectedModel, models);
    const savedEffort = this.readSavedReasoningEfforts()[selectedModel];
    const defaultEffort = models.find(
      (item) => item.slug === selectedModel,
    )?.defaultReasoningEffort;
    const selectedReasoningEffort = efforts.includes(savedEffort)
      ? savedEffort
      : defaultEffort && efforts.includes(defaultEffort)
        ? defaultEffort
        : efforts[0];
    this.updateViewState({
      models,
      selectedModel,
      availableReasoningEfforts: efforts,
      selectedReasoningEffort,
    });
  }

  private getReasoningEffortsForModel(
    model: string,
    models: SidebarModelView[],
  ): string[] {
    return (
      models.find((item) => item.slug === model)?.supportedReasoningEfforts ||
      []
    );
  }

  private readSavedReasoningEfforts(): Record<string, string> {
    const raw = String(getPref("codex.reasoningEfforts") || "{}");
    try {
      const parsed = JSON.parse(raw) as unknown;
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

  private updateSessionControls(): void {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      this.hideSessionPopover();
    } else if (this.viewState.sessionsOpen) {
      this.updateViewState({
        sessions: this.viewState.sessions.map((session) =>
          createSessionView(
            session.conversation,
            ready.conversation.metadata.id,
          ),
        ),
      });
    }
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
        messages: createConversationMessages(
          state.conversation,
          runningTurn
            ? {
                text: runningTurn.assistantOutput,
                interrupted: runningTurn.interrupted,
                running: !runningTurn.interrupted,
              }
            : undefined,
        ),
        busy: Boolean(runningTurn),
        skills: this.loadSkillViewsForDisplayState(state),
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
      skills: this.loadSkillViewsForDisplayState(state),
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

  private loadSkillViewsForDisplayState(
    state: DisplayState,
  ): SidebarState["skills"] {
    return loadSkillViews({
      hasReader:
        state.kind === "loading" ||
        state.kind === "ready" ||
        (state.kind === "error" && Boolean(state.reader)),
      hasWorkspace: state.kind === "ready",
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
        this.queueCodexStatusCheck();
      }
      this.focusComposer();
    }
  }

  private closeZopilotPane(options: { restoreItemPane?: boolean } = {}): void {
    this.open = false;
    this.selectionToken++;
    this.displayState = { kind: "closed", token: this.selectionToken };
    this.hideSessionPopover();
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

  private async syncWithSelectedPDFReader(): Promise<void> {
    const token = ++this.selectionToken;
    const selectedReader = getSelectedPDFReader(this.win);
    if (!selectedReader) {
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
      await this.loadReaderConversation(selectedReader, token);
    } else {
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
      this.hideSessionPopover();
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
        void this.archiveSession(conversation);
      },
      close: () => this.setOpen(false),
      createNewSession: () => {
        void this.createNewSession();
      },
      hideSessions: () => this.hideSessionPopover(),
      interruptActiveTurn: () => this.interruptActiveTurn(),
      openExternalLink: (url) => {
        if (isSafeExternalURL(url, this.win)) {
          Zotero.launchURL(url);
        }
      },
      openReaderLocator: (locator) => {
        void this.openReaderLocator(locator);
      },
      createPrompt: (input) => this.createPrompt(input),
      deletePrompt: (promptId) => this.deletePrompt(promptId),
      selectModel: (model) => this.selectModel(model),
      selectMode: (mode) => this.selectMode(mode),
      selectReasoningEffort: (effort) => this.selectReasoningEffort(effort),
      setSkillEnabled: (skillId, enabled) =>
        this.setSkillEnabled(skillId, enabled),
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
      uploadAttachment: () => {
        void this.uploadAttachment();
      },
      switchSession: (conversation) => {
        void this.switchSession(conversation);
      },
      restoreSession: (conversation) => {
        void this.restoreSession(conversation);
      },
      toggleArchivedSessions: () => {
        void this.toggleSessionPopover("archive");
      },
      toggleSessions: () => {
        void this.toggleSessionPopover("history");
      },
    });
  }
}

const __sidebarControllerTestHooks = {
  SidebarController,
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

function buildPromptWithSourceRefs(
  promptText: string,
  mentions: SourceMention[],
): string {
  if (!mentions.length) {
    return promptText;
  }
  const sourceRefs = mentions.map((mention) => ({
    sourceId: mention.sourceId,
    title: mention.title,
    paperKey: mention.paperKey,
  }));
  return [
    promptText,
    "",
    "Zopilot selected sources from @ mentions:",
    JSON.stringify(sourceRefs),
    "When using paper_read for this question, pass sourceIds exactly as listed above.",
  ].join("\n");
}

function buildPromptWithMode(promptText: string, mode: SidebarMode): string {
  const modeInstruction =
    mode === "agent"
      ? "Zopilot mode: agent. You may plan multi-step work and use available tools when useful. Ask for confirmation before destructive or external side effects."
      : "Zopilot mode: ask. Focus on reading, explanation, and direct answers. Avoid taking tool-driven actions unless they are needed to answer from the current evidence.";
  return [modeInstruction, "", promptText].join("\n");
}

function readSavedMode(): SidebarMode {
  const value = getPref("codex.mode");
  return value === "agent" || value === "ask" ? value : "ask";
}

function formatCodexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [getString("sidebar-codex-error"), "", "```", message, "```"].join(
    "\n",
  );
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
