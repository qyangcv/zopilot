import type {
  Conversation,
  PaperIdentity,
  SourceMention,
  WorkspaceIdentity,
  WorkspaceType,
} from "../../../domain/conversation";
import { ZoteroSourceUniverse } from "../../../integrations/zotero/ZoteroWorkspaceService";
import { getSelectedPDFReader } from "../../../integrations/zotero/reader";
import { isLibraryTab } from "../../../integrations/zotero/selectedWorkspace";
import type {
  SidebarPromptSubmission,
  SidebarReloadContext,
  SidebarSessionStatus,
  SidebarState,
} from "../ui/types";
import { getSelectedItemTitle } from "./selectedItem";
import { SidebarSessionCoordinator } from "../chat/SessionCoordinator";
import { loadPromptViews, subscribePromptViews } from "../prompts/promptStore";
import { createInitialSidebarState } from "../state/viewModel";
import { createPdfHelperNoticeText } from "../chat/pdfHelperGate";
import { PdfHelperPromptGuard } from "../chat/PdfHelperPromptGuard";
import { ProviderCatalogController } from "../providers/ProviderCatalogController";
import { TurnCoordinator } from "../chat/TurnCoordinator";
import { RunningTurnStore } from "../chat/RunningTurnStore";
import { StreamRenderScheduler } from "../chat/StreamRenderScheduler";
import {
  WorkspaceCoordinator,
  type SidebarHostContext,
  type SidebarDisplayState,
} from "../workspace/WorkspaceCoordinator";
import { projectSidebarState } from "../state/projectSidebarState";
import {
  SidebarHostBindings,
  getSidebarSelectionText,
} from "./SidebarHostBindings";
import { SidebarContextActions } from "../context/SidebarContextActions";
import { SidebarSurface } from "./SidebarSurface";
import { formatBackendError } from "../chat/formatBackendError";
import { createSidebarActions } from "./createSidebarActions";
import { ReaderSelectionCoordinator } from "./ReaderSelectionCoordinator";
import { LibrarySelectionCoordinator } from "./LibrarySelectionCoordinator";
import type { SidebarSurfaceKind } from "./SidebarSurface";
import { ZoteroDroppedContextResolver } from "../context/ZoteroDroppedContextResolver";
import type { SidebarDropPayload } from "../../../integrations/zotero/compat/dragData";
import { getString } from "../../../app/localization";
import {
  consumeReloadContext,
  peekReloadContext,
  requestPluginReload,
} from "../../../app/pluginLifecycle";
import { createLogger } from "../../../runtime/logging/logger";
import { DetachedChatWindow } from "./DetachedChatWindow";

const controllers = new WeakMap<Window, SidebarHostController>();
const logger = createLogger("sidebar.host");
export {
  prepareAllSidebarsForShutdown,
  registerSidebar,
  unregisterSidebar,
  unregisterAllSidebars,
};

type DisplayState = SidebarDisplayState;

function registerSidebar(win: _ZoteroTypes.MainWindow): void {
  const existing = controllers.get(win);
  if (existing) {
    existing.refreshContext();
    return;
  }
  const controller = new SidebarHostController(win);
  controllers.set(win, controller);
  controller.mount();
}

function unregisterSidebar(
  win: Window,
  options: { restoreHost?: boolean } = { restoreHost: true },
): void {
  const controller = controllers.get(win);
  if (!controller) {
    return;
  }
  controller.destroy(options);
  controllers.delete(win);
}

function unregisterAllSidebars(): void {
  Zotero.getMainWindows().forEach((win) => unregisterSidebar(win));
}

async function prepareAllSidebarsForShutdown(): Promise<void> {
  const results = await Promise.allSettled(
    Zotero.getMainWindows()
      .map((win) => controllers.get(win)?.prepareForShutdown())
      .filter((pending): pending is Promise<void> => Boolean(pending)),
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      logger.error("failed to settle a sidebar before shutdown", result.reason);
    }
  });
}

class SidebarHostController {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly surface: SidebarSurface;
  private readonly detachedWindow: DetachedChatWindow;
  private open = false;
  private destroyed = false;
  private selectionToken = 0;
  private displayState: DisplayState = { kind: "closed", token: 0 };
  private viewState: SidebarState;
  private readonly sessions: SidebarSessionCoordinator;
  private readonly sourceUniverse: ZoteroSourceUniverse;
  private readonly droppedContextResolver: ZoteroDroppedContextResolver;
  private readonly providerCatalog: ProviderCatalogController;
  private readonly workspaceCoordinator: WorkspaceCoordinator;
  private readonly readerSelection: ReaderSelectionCoordinator;
  private readonly librarySelection: LibrarySelectionCoordinator;
  private readonly turnStore = new RunningTurnStore();
  private readonly unreadConversationIds = new Set<string>();
  private readonly streamScheduler: StreamRenderScheduler;
  private readonly turnCoordinator: TurnCoordinator;
  private readonly hostBindings: SidebarHostBindings;
  private readonly contextActions: SidebarContextActions;
  private readonly listeners: Array<() => void> = [];
  private readonly pendingFrames = new Set<number>();
  private readonly pendingTimeouts = new Set<number>();
  private readonly pdfHelperGuard: PdfHelperPromptGuard;

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    this.sourceUniverse = new ZoteroSourceUniverse(
      (win as Window & { Zotero?: typeof Zotero }).Zotero || Zotero,
    );
    this.droppedContextResolver = new ZoteroDroppedContextResolver(
      (win as Window & { Zotero?: typeof Zotero }).Zotero || Zotero,
    );
    this.surface = new SidebarSurface(win, {
      isDestroyed: () => this.destroyed,
      isOpen: () => this.open,
      onActiveSurfaceChange: (kind, active) =>
        this.handleActiveSurfaceChange(kind, active),
      onUnavailable: () => this.setOpen(false),
      onReady: () => this.renderApp(),
    });
    this.detachedWindow = new DetachedChatWindow(win, {
      onClose: () => this.handleDetachedWindowClosed(),
      onReady: () => this.handleDetachedWindowReady(),
    });
    this.streamScheduler = new StreamRenderScheduler({
      win: this.win,
      getActiveConversationId: () =>
        this.getReadyDisplayState()?.conversation.metadata.id,
      getSnapshot: (conversationId) =>
        this.turnStore.getSnapshot(conversationId),
      publish: (snapshot) => {
        this.surface.publishStreaming(snapshot);
        this.detachedWindow.publishStreaming(snapshot);
      },
    });
    this.streamScheduler.setVisible(false);
    const label = getSelectedItemTitle(this.win);
    this.viewState = createInitialSidebarState(label);
    this.viewState.prompts = loadPromptViews();
    this.providerCatalog = new ProviderCatalogController({
      getViewState: () => this.viewState,
      updateViewState: (patch) => this.updateViewState(patch),
      isDestroyed: () => this.destroyed,
      isOpen: () => this.open,
    });
    this.workspaceCoordinator = new WorkspaceCoordinator({
      win: this.win,
      getSourceUniverse: () => this.sourceUniverse,
      getViewState: () => this.viewState,
      getReadyDisplayState: () => this.getReadyDisplayState(),
      nextSelectionToken: () => ++this.selectionToken,
      canCommitSelection: (token) => this.canCommitSelection(token),
      setDisplayState: (state) => this.setDisplayState(state),
      updateViewState: (patch) => this.updateViewState(patch),
      formatError: (error) => formatBackendError(error),
      activateWorkspace: (input) => this.loadWorkspaceConversation(input),
    });
    this.readerSelection = new ReaderSelectionCoordinator({
      win: this.win,
      surface: this.surface,
      workspaceCoordinator: this.workspaceCoordinator,
      isOpen: () => this.open,
      nextToken: () => ++this.selectionToken,
      getToken: () => this.selectionToken,
      canCommit: (token) => this.canCommitSelection(token),
      getDisplayState: () => this.displayState,
      getReadyDisplayState: () => this.getReadyDisplayState(),
      setDisplayState: (state) => this.setDisplayState(state),
      setClosedDisplayState: (token) => {
        this.displayState = { kind: "closed", token };
      },
      setOpen: (open) => this.setOpen(open),
      renderDisplayState: () => this.renderDisplayState(),
    });
    this.librarySelection = new LibrarySelectionCoordinator({
      win: this.win,
      surface: this.surface,
      workspaceCoordinator: this.workspaceCoordinator,
      isOpen: () => this.open,
      nextToken: () => ++this.selectionToken,
      getToken: () => this.selectionToken,
      canCommit: (token) => this.canCommitSelection(token),
      getDisplayState: () => this.displayState,
      getReadyDisplayState: () => this.getReadyDisplayState(),
      setDisplayState: (state) => this.setDisplayState(state),
      setClosedDisplayState: (token) => {
        this.displayState = { kind: "closed", token };
      },
      setOpen: (open) => this.setOpen(open),
      renderDisplayState: () => this.renderDisplayState(),
    });
    this.pdfHelperGuard = new PdfHelperPromptGuard(() =>
      this.renderDisplayState(),
    );
    this.contextActions = new SidebarContextActions(this.win, () =>
      this.getReadyDisplayState(),
    );
    this.turnCoordinator = new TurnCoordinator({
      turnStore: this.turnStore,
      streamScheduler: this.streamScheduler,
      getViewState: () => this.viewState,
      getReadyConversation: async () =>
        (await this.getReadyStateForActiveContext())?.conversation,
      getActiveConversationId: () =>
        this.getReadyDisplayState()?.conversation.metadata.id,
      ensurePromptReady: (conversation) =>
        this.pdfHelperGuard.ensureCurrent(conversation),
      clearPromptNotice: (conversationId) =>
        this.pdfHelperGuard.clear(conversationId),
      setReadyConversation: (conversation) =>
        this.setReadyConversation(conversation),
      updateViewState: (patch) => this.updateViewState(patch),
      refreshBackendDiagnostic: (error, providerProfileId, model) =>
        this.showBackendDiagnostic(error, providerProfileId, model),
      markBackendHealthy: (providerProfileId, model) =>
        this.providerCatalog.markBackendHealthy(providerProfileId, model),
      markConversationUnread: (conversationId) =>
        this.unreadConversationIds.add(conversationId),
      refreshSessions: () => {
        if (this.viewState.detachedWindowOpen) {
          void this.sessions.refreshNavigationSessions();
        } else {
          void this.sessions.showPopover();
        }
      },
      areSessionsOpen: () =>
        this.viewState.sessionsOpen || this.viewState.detachedWindowOpen,
    });
    this.sessions = new SidebarSessionCoordinator({
      getReadyDisplayState: () => this.getReadyDisplayState(),
      getReadyStateForActiveContext: () => this.getReadyStateForActiveContext(),
      getViewState: () => this.viewState,
      updateViewState: (patch) => this.updateViewState(patch),
      setReadyConversation: (conversation) =>
        this.setReadyConversation(conversation),
      getSessionStatus: (conversationId) =>
        this.getSessionStatus(conversationId),
      markSessionRead: (conversationId) =>
        this.unreadConversationIds.delete(conversationId),
      focusComposer: () => this.focusComposer(),
      interruptConversationTurn: (conversationId) =>
        this.turnCoordinator.interruptConversation(conversationId),
      isDestroyed: () => this.destroyed,
      isOpen: () => this.open,
    });
    this.hostBindings = new SidebarHostBindings({
      doc: this.doc,
      win: this.win,
      ensureMountedSurfaces: () => this.ensureMountedSurfaces(),
      refreshContext: () => this.refreshContext(),
      syncWithSelectedContext: () => {
        void this.syncWithSelectedContext();
      },
      isOpen: () => this.open,
      isDestroyed: () => this.destroyed,
      getDeckPanel: () => this.surface.panel,
      getHostMutationTargets: () => this.surface.getHostMutationTargets(),
      subscribePrompts: subscribePromptViews,
      updatePrompts: (prompts) => this.updateViewState({ prompts }),
      subscribeProviders: () => this.providerCatalog.subscribe(),
    });
  }

  mount(): void {
    this.surface.mount();
    this.listeners.push(...this.hostBindings.bind());
    const reloadContext = peekReloadContext();
    if (
      reloadContext?.hostContextKind === "library" &&
      isLibraryTab(this.win)
    ) {
      this.librarySelection.openPane();
    } else if (reloadContext?.hostContextKind === "reader") {
      this.readerSelection.openPane();
    } else {
      this.refreshContext();
    }
  }

  prepareForShutdown(): Promise<void> {
    return this.turnCoordinator.prepareForShutdown();
  }

  destroy(options: { restoreHost?: boolean } = { restoreHost: true }): void {
    this.destroyed = true;
    this.pendingFrames.forEach((frame) => this.win.cancelAnimationFrame(frame));
    this.pendingFrames.clear();
    this.pendingTimeouts.forEach((timeout) => this.win.clearTimeout(timeout));
    this.pendingTimeouts.clear();
    this.listeners.splice(0).forEach((dispose) => dispose());
    this.streamScheduler.destroy();
    this.detachedWindow.destroy();
    this.surface.destroy(options);
  }

  refreshContext(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.hasDetachedWindow()) {
      return;
    }
    if (isLibraryTab(this.win)) {
      this.librarySelection.refreshContext();
    } else {
      this.readerSelection.refreshContext(reader);
    }
  }

  private ensureMountedSurfaces(): void {
    this.surface.ensureMounted();
  }

  private handleDetachedWindowReady(): void {
    if (this.destroyed) return;
    this.updateViewState({
      detachedWindowOpen: true,
      sessionsOpen: false,
    });
    void this.sessions.refreshNavigationSessions();
  }

  private handleDetachedWindowClosed(): void {
    if (this.destroyed) return;
    this.updateViewState({
      detachedWindowOpen: false,
      sessionsOpen: false,
      focusToken: this.viewState.focusToken + 1,
    });
    void this.syncWithSelectedContext();
  }

  private openDetachedWindow(): void {
    const wasOpen = this.detachedWindow.isOpen();
    this.detachedWindow.open();
    if (!wasOpen && this.detachedWindow.isOpen()) {
      this.selectionToken++;
    }
  }

  private hasDetachedWindow(): boolean {
    return this.viewState.detachedWindowOpen || this.detachedWindow.isOpen();
  }

  private openZopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    this.readerSelection.openPane(reader);
  }

  private async loadWorkspaceConversation(input: {
    token: number;
    hostContext?: SidebarHostContext;
    reader?: _ZoteroTypes.ReaderInstance<"pdf">;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity | null;
  }): Promise<void> {
    await this.workspaceCoordinator.loadWorkspaceConversation(input);
  }

  private async submitPromptAsync(
    submission: SidebarPromptSubmission,
  ): Promise<void> {
    let accepted = false;
    try {
      accepted = await this.turnCoordinator.submitPrompt(submission);
    } catch (error) {
      logger.error("failed to submit sidebar prompt", error);
    }
    if (this.destroyed) return;
    this.updateViewState({
      submissionResult: {
        id: submission.id,
        status: accepted ? "accepted" : "rejected",
      },
    });
  }

  private interruptActiveTurn(): void {
    this.turnCoordinator.interruptActive();
  }

  private async reloadPlugin(context: SidebarReloadContext): Promise<void> {
    if (this.viewState.reloading) return;
    if (
      this.viewState.busy &&
      !Services.prompt.confirm(
        this.win as unknown as mozIDOMWindowProxy,
        getString("sidebar-title"),
        getString("sidebar-reload-confirm"),
      )
    ) {
      return;
    }

    this.updateViewState({ reloading: true });
    try {
      await requestPluginReload(context);
    } catch (error) {
      logger.error("failed to reload Zopilot", error);
      if (this.destroyed) return;
      this.updateViewState({ reloading: false });
      Services.prompt.alert(
        this.win as unknown as mozIDOMWindowProxy,
        getString("sidebar-title"),
        getString("sidebar-reload-failed"),
      );
    }
  }

  private async showBackendDiagnostic(
    error?: unknown,
    providerProfileId?: string,
    model?: string,
  ): Promise<void> {
    await this.providerCatalog.refreshActiveBackendDiagnostic(
      error,
      providerProfileId,
      model,
    );
  }

  private selectModel(value: string): void {
    this.providerCatalog.selectModel(value);
  }

  private selectModelEffort(model: string, effort: string): void {
    this.providerCatalog.selectModelEffort(model, effort);
  }

  private async selectWorkspaceMode(type: WorkspaceType): Promise<void> {
    await this.workspaceCoordinator.selectWorkspaceMode(type);
  }

  private async selectCollectionWorkspace(
    collectionKey: string,
  ): Promise<void> {
    await this.workspaceCoordinator.selectCollectionWorkspace(collectionKey);
  }

  private async selectItemWorkspace(sourceId: string): Promise<void> {
    await this.workspaceCoordinator.selectItemWorkspace(sourceId);
  }

  private async getItemContextTree(source: SourceMention) {
    const ready = this.getReadyDisplayState();
    if (!ready) {
      return undefined;
    }
    const canonicalSource =
      this.viewState.sourceCandidates.find(
        (candidate) => candidate.sourceId === source.sourceId,
      ) ||
      this.viewState.sourceCandidates.find(
        (candidate) =>
          candidate.libraryID === source.libraryID &&
          Boolean(candidate.parentItemKey) &&
          candidate.parentItemKey === source.parentItemKey,
      );
    if (
      !canonicalSource ||
      canonicalSource.libraryID !== ready.workspace.libraryID
    ) {
      return undefined;
    }
    const workspace =
      await this.sourceUniverse.createItemWorkspace(canonicalSource);
    return this.sourceUniverse.getItemContextTree({
      workspace,
      currentSource: canonicalSource,
    });
  }

  private async resolveDroppedContext(input: {
    payload: SidebarDropPayload;
    workspaceKey: string;
  }) {
    const ready = this.getReadyDisplayState();
    if (
      !ready ||
      ready.hostContext?.kind !== "library" ||
      ready.workspace.workspaceKey !== input.workspaceKey
    ) {
      return [];
    }
    return this.droppedContextResolver.resolve({
      payload: input.payload,
      workspace: ready.workspace,
      currentSource: ready.currentSource,
    });
  }

  private getReadyDisplayState():
    Extract<DisplayState, { kind: "ready" }> | undefined {
    return this.displayState.kind === "ready" ? this.displayState : undefined;
  }

  private async getReadyStateForActiveContext(): Promise<
    Extract<DisplayState, { kind: "ready" }> | undefined
  > {
    if (this.hasDetachedWindow()) {
      return this.getReadyDisplayState();
    }
    return isLibraryTab(this.win)
      ? this.librarySelection.getReadyStateForSelectedWorkspace()
      : this.readerSelection.getReadyStateForSelectedReader();
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
    if (displayState.kind === "ready") {
      this.unreadConversationIds.delete(displayState.conversation.metadata.id);
    }
    this.displayState = displayState;
    this.renderDisplayState();
    this.streamScheduler.publishActive();
  }

  private renderDisplayState(): void {
    const ready = this.getReadyDisplayState();
    const projected = projectSidebarState({
      displayState: this.displayState,
      viewState: this.viewState,
      busy: this.turnStore.has(ready?.conversation.metadata.id),
      pdfHelperNotice: this.pdfHelperGuard.notice,
      getSessionStatus: (conversationId) =>
        this.getSessionStatus(conversationId),
      getClosedLabel: () =>
        getSelectedItemTitle(this.win, getSelectedPDFReader(this.win)),
    });
    if (ready && !this.viewState.reloading) {
      consumeReloadContext(
        ready.workspace.workspaceKey,
        ready.conversation.metadata.id,
      );
    }
    this.updateViewState(projected);
    if (this.viewState.detachedWindowOpen) {
      this.sessions.ensureNavigationSessions();
    }
  }

  private canCommitSelection(token: number): boolean {
    return !this.destroyed && this.open && token === this.selectionToken;
  }

  private getSessionStatus(
    conversationId: string,
  ): SidebarSessionStatus | undefined {
    if (this.turnStore.has(conversationId)) return "running";
    if (this.unreadConversationIds.has(conversationId)) return "unread";
    return undefined;
  }

  private setOpen(open: boolean): void {
    this.open = open;
    if (!open) {
      this.closeZopilotPane({ restoreItemPane: true });
      return;
    }
    this.streamScheduler.setVisible(true);
    this.renderDisplayState();
    this.scheduleFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });
    this.focusComposer();
  }

  private closeZopilotPane(
    options: {
      restoreItemPane?: boolean;
      collapseActiveHost?: boolean;
    } = {},
  ): void {
    this.open = false;
    this.streamScheduler.setVisible(false);
    this.selectionToken++;
    this.displayState = { kind: "closed", token: this.selectionToken };
    this.sessions.hidePopover();
    this.updateViewState({ busy: false, composerEnabled: false });
    this.surface.close(options);
    this.renderDisplayState();
    this.scheduleFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });
  }

  private focusComposer(): void {
    this.scheduleFrame(() => {
      this.updateViewState({ focusToken: this.viewState.focusToken + 1 });
    });
  }

  private scheduleFrame(callback: () => void): void {
    if (this.destroyed) return;
    let completedSynchronously = false;
    let frame = 0;
    frame = this.win.requestAnimationFrame(() => {
      completedSynchronously = true;
      this.pendingFrames.delete(frame);
      if (!this.destroyed) callback();
    });
    if (!completedSynchronously) this.pendingFrames.add(frame);
  }

  private scheduleTimeout(callback: () => void): void {
    if (this.destroyed) return;
    let timeout = 0;
    timeout = this.win.setTimeout(() => {
      this.pendingTimeouts.delete(timeout);
      if (!this.destroyed) callback();
    }, 0);
    this.pendingTimeouts.add(timeout);
  }

  private handleActiveSurfaceChange(
    kind: SidebarSurfaceKind,
    active: boolean,
  ): void {
    if (this.destroyed) {
      return;
    }
    if (this.hasDetachedWindow()) {
      return;
    }
    if (active) {
      if (this.open && this.surface.isActive(kind)) {
        return;
      }
      if (kind === "library") this.librarySelection.openPane();
      else this.openZopilotPane();
      return;
    }
    if (this.open) {
      this.closeZopilotPane();
    }
  }

  private async syncWithSelectedContext(): Promise<void> {
    if (this.hasDetachedWindow()) {
      return;
    }
    if (isLibraryTab(this.win)) {
      await this.librarySelection.syncWithSelectedWorkspace();
      return;
    }
    if (this.open) {
      this.surface.attach(getSelectedPDFReader(this.win));
    }
    await this.readerSelection.syncWithSelectedPDFReader();
  }

  private updateViewState(patch: Partial<SidebarState>): void {
    this.viewState = {
      ...this.viewState,
      ...patch,
    };
    this.renderApp();
  }

  private renderApp(): void {
    const actions = createSidebarActions({
      archiveSession: (conversation) =>
        void this.sessions.archiveSession(conversation),
      close: () =>
        this.closeZopilotPane({
          restoreItemPane: true,
          collapseActiveHost: true,
        }),
      createNewSession: () => void this.sessions.createNewSession(),
      getItemContextTree: (source) => this.getItemContextTree(source),
      resolveDroppedContext: (input) => this.resolveDroppedContext(input),
      reloadPlugin: (context) => this.reloadPlugin(context),
      hideSessions: () => this.sessions.hidePopover(),
      interruptActiveTurn: () => this.interruptActiveTurn(),
      openInWindow: () => this.openDetachedWindow(),
      openExternalLink: (url) => this.contextActions.openExternalLink(url),
      restoreToSidebar: () => this.detachedWindow.close(),
      selectModel: (model) => this.selectModel(model),
      selectModelEffort: (model, effort) =>
        this.selectModelEffort(model, effort),
      selectWorkspaceMode: (type) => void this.selectWorkspaceMode(type),
      selectCollectionWorkspace: (collectionKey) =>
        void this.selectCollectionWorkspace(collectionKey),
      selectItemWorkspace: (sourceId) =>
        void this.selectItemWorkspace(sourceId),
      submitPrompt: (submission) => void this.submitPromptAsync(submission),
      uploadAttachment: () => this.contextActions.uploadAttachment(),
      switchSession: (conversation) =>
        void this.sessions.switchSession(conversation),
      restoreSession: (conversation) =>
        void this.sessions.restoreSession(conversation),
      toggleArchivedSessions: () => void this.sessions.togglePopover("archive"),
      toggleSessions: () => void this.sessions.togglePopover("history"),
    });
    this.surface.render(this.viewState, actions);
    this.detachedWindow.render(this.viewState, actions);
  }
}

const __sidebarControllerTestHooks = {
  SidebarController: SidebarHostController,
  SidebarHostController,
  createPdfHelperNoticeText,
  getSidebarSelectionText,
};

export { __sidebarControllerTestHooks };
