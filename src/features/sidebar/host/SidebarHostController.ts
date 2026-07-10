import { config } from "../../../../package.json";
import type {
  Conversation,
  PaperIdentity,
  WorkspaceIdentity,
  WorkspaceType,
} from "../../../domain/conversation";
import { ZoteroSourceUniverse } from "../../../integrations/zotero/ZoteroWorkspaceService";
import { getSelectedPDFReader } from "../../../integrations/zotero/reader";
import { isLibraryTab } from "../../../integrations/zotero/selectedWorkspace";
import type { SidebarPromptSubmission, SidebarState } from "../ui/types";
import { getSelectedItemTitle } from "./selectedItem";
import { SidebarSessionCoordinator } from "../chat/SessionCoordinator";
import { loadPromptViews, subscribePromptViews } from "../prompts/promptStore";
import { createInitialSidebarState } from "../state/viewModel";
import { createPdfHelperNoticeText } from "../chat/pdfHelperGate";
import { PdfHelperPromptGuard } from "../chat/PdfHelperPromptGuard";
import { ProviderCatalogController } from "../providers/ProviderCatalogController";
import { TurnCoordinator, type RunningTurn } from "../chat/TurnCoordinator";
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

const controllers = new WeakMap<Window, SidebarHostController>();
export { registerSidebar, unregisterSidebar, unregisterAllSidebars };

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

class SidebarHostController {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly surface: SidebarSurface;
  private open = false;
  private destroyed = false;
  private selectionToken = 0;
  private displayState: DisplayState = { kind: "closed", token: 0 };
  private viewState: SidebarState;
  private readonly sessions: SidebarSessionCoordinator;
  private readonly sourceUniverse: ZoteroSourceUniverse;
  private readonly providerCatalog: ProviderCatalogController;
  private readonly workspaceCoordinator: WorkspaceCoordinator;
  private readonly readerSelection: ReaderSelectionCoordinator;
  private readonly librarySelection: LibrarySelectionCoordinator;
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly turnCoordinator: TurnCoordinator;
  private readonly hostBindings: SidebarHostBindings;
  private readonly contextActions: SidebarContextActions;
  private readonly listeners: Array<() => void> = [];
  private readonly pdfHelperGuard: PdfHelperPromptGuard;

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    this.sourceUniverse = new ZoteroSourceUniverse(
      (win as Window & { Zotero?: typeof Zotero }).Zotero || Zotero,
    );
    this.surface = new SidebarSurface(win, {
      pluginID: config.addonID,
      isDestroyed: () => this.destroyed,
      isOpen: () => this.open,
      onActiveSurfaceChange: (kind, active) =>
        this.handleActiveSurfaceChange(kind, active),
      onUnavailable: () => this.setOpen(false),
      onReady: () => this.renderApp(),
    });
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
      runningTurns: this.runningTurns,
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
      renderDisplayState: () => this.renderDisplayState(),
      refreshBackendDiagnostic: (error) => this.showBackendDiagnostic(error),
      refreshSessions: () => {
        void this.sessions.showPopover();
      },
      areSessionsOpen: () => this.viewState.sessionsOpen,
    });
    this.sessions = new SidebarSessionCoordinator({
      getReadyDisplayState: () => this.getReadyDisplayState(),
      getReadyStateForActiveContext: () => this.getReadyStateForActiveContext(),
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
      areSessionsOpen: () => this.viewState.sessionsOpen,
      getDeckPanel: () => this.surface.panel,
      hideSessions: () => this.sessions.hidePopover(),
      subscribePrompts: subscribePromptViews,
      updatePrompts: (prompts) => this.updateViewState({ prompts }),
      subscribeProviders: () => this.providerCatalog.subscribe(),
    });
  }

  mount(): void {
    this.surface.mount();
    this.listeners.push(...this.hostBindings.bind());
    this.refreshContext();
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.splice(0).forEach((dispose) => dispose());
    this.surface.destroy();
  }

  refreshContext(reader?: _ZoteroTypes.ReaderInstance): void {
    if (isLibraryTab(this.win)) {
      this.librarySelection.refreshContext();
    } else {
      this.readerSelection.refreshContext(reader);
    }
  }

  private ensureMountedSurfaces(): void {
    this.surface.ensureMounted();
  }

  private openZopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    this.readerSelection.openPane(reader);
  }

  private queueBackendStatusCheck(): void {
    this.win.setTimeout(() => {
      if (!this.destroyed) {
        void this.providerCatalog.refresh();
      }
    }, 0);
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
    await this.turnCoordinator.submitPrompt(submission);
  }

  private refreshRunningTurnView(runningTurn: RunningTurn): void {
    this.turnCoordinator.refreshView(runningTurn);
  }

  private interruptActiveTurn(): void {
    this.turnCoordinator.interruptActive();
  }

  private interruptRunningTurn(runningTurn: RunningTurn): void {
    this.turnCoordinator.interrupt(runningTurn);
  }

  private async showBackendDiagnostic(error?: unknown): Promise<void> {
    await this.providerCatalog.refreshActiveBackendDiagnostic(error);
  }

  private selectModel(value: string): void {
    this.providerCatalog.selectModel(value);
  }

  private selectReasoningEffort(effort: string): void {
    this.providerCatalog.selectReasoningEffort(effort);
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

  private getReadyDisplayState():
    | Extract<DisplayState, { kind: "ready" }>
    | undefined {
    return this.displayState.kind === "ready" ? this.displayState : undefined;
  }

  private async getReadyStateForActiveContext(): Promise<
    Extract<DisplayState, { kind: "ready" }> | undefined
  > {
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
    this.displayState = displayState;
    this.renderDisplayState();
    this.surface.refreshToolbar();
  }

  private renderDisplayState(): void {
    this.updateViewState(
      projectSidebarState({
        displayState: this.displayState,
        viewState: this.viewState,
        runningTurns: this.runningTurns,
        pdfHelperNotice: this.pdfHelperGuard.notice,
        getClosedLabel: () =>
          getSelectedItemTitle(this.win, getSelectedPDFReader(this.win)),
      }),
    );
  }

  private canCommitSelection(token: number): boolean {
    return !this.destroyed && this.open && token === this.selectionToken;
  }

  private setOpen(open: boolean): void {
    const wasOpen = this.open;
    this.open = open;
    if (open) {
      if (isLibraryTab(this.win)) {
        this.surface.attachLibrary();
      } else {
        this.surface.attach(getSelectedPDFReader(this.win));
      }
    } else {
      this.closeZopilotPane({ restoreItemPane: true });
      return;
    }
    this.surface.refreshToolbar();
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
    this.surface.close(Boolean(options.restoreItemPane));
    this.renderDisplayState();
    this.win.requestAnimationFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });
  }

  private focusComposer(): void {
    this.win.requestAnimationFrame(() => {
      this.updateViewState({ focusToken: this.viewState.focusToken + 1 });
    });
  }

  private handleActiveSurfaceChange(
    kind: SidebarSurfaceKind,
    active: boolean,
  ): void {
    if (this.destroyed) {
      return;
    }
    if (active) {
      if (kind === "library") this.librarySelection.openPane();
      else this.openZopilotPane();
      return;
    }
    if (this.open) {
      this.closeZopilotPane();
    }
  }

  private async syncWithSelectedContext(): Promise<void> {
    if (isLibraryTab(this.win)) {
      if (
        this.open &&
        this.getReadyDisplayState()?.hostContext?.kind !== "library"
      ) {
        this.surface.attachLibrary();
      }
      await this.librarySelection.syncWithSelectedWorkspace();
      return;
    }
    const ready = this.getReadyDisplayState();
    if (this.open && ready?.hostContext?.kind !== "reader" && !ready?.reader) {
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
    this.surface.render(
      this.viewState,
      createSidebarActions({
        archiveSession: (conversation) =>
          void this.sessions.archiveSession(conversation),
        close: () => this.setOpen(false),
        createNewSession: () => void this.sessions.createNewSession(),
        hideSessions: () => this.sessions.hidePopover(),
        interruptActiveTurn: () => this.interruptActiveTurn(),
        openExternalLink: (url) => this.contextActions.openExternalLink(url),
        openReaderLocator: (locator) =>
          void this.contextActions.openReaderLocator(locator),
        selectModel: (model) => this.selectModel(model),
        selectReasoningEffort: (effort) => this.selectReasoningEffort(effort),
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
        toggleArchivedSessions: () =>
          void this.sessions.togglePopover("archive"),
        toggleSessions: () => void this.sessions.togglePopover("history"),
      }),
    );
  }
}

const __sidebarControllerTestHooks = {
  SidebarController: SidebarHostController,
  SidebarHostController,
  createPdfHelperNoticeText,
  getSidebarSelectionText,
};

export { __sidebarControllerTestHooks };
