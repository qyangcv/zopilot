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
  WorkspaceIdentity,
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
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  isPDFReader,
} from "../../zotero/reader";
import { copyText } from "./app/clipboard";
import { createSidebarReactHost, type SidebarReactHost } from "./app/reactHost";
import type {
  SidebarModelView,
  SidebarSessionMode,
  SidebarState,
} from "./app/types";
import { HTML_NS, SIDEBAR_ID, STYLE_URI } from "./constants";
import { ReaderToolbarController } from "./readerToolbar";
import { getSelectedItemTitle } from "./selectedItem";
import {
  DEFAULT_MODEL,
  createConversationMessages,
  createInitialSidebarState,
  createSessionView,
} from "./viewModel";

const controllers = new WeakMap<Window, SidebarController>();
const DEFAULT_SIDEBAR_WIDTH = 372;
const COMPACT_VIEWPORT_WIDTH = 860;
const DEFAULT_COLLAPSE_THRESHOLD = 300;
const COMPACT_COLLAPSE_THRESHOLD = 280;
const CODEX_TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";
const logger = createLogger("sidebar.controller");
export {
  registerSidebar,
  unregisterSidebar,
  unregisterAllSidebars,
  getSidebarCollapseThreshold,
  getInitialSidebarWidth,
  resolveSidebarResizeWidth,
};

type RunningTurn = {
  conversation: Conversation;
  assistantOutput: string;
  model?: string;
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
  private shell?: XUL.Box;
  private reactHost?: SidebarReactHost;
  private reactHostLoading = false;
  private appMount?: HTMLElement;
  private open = false;
  private destroyed = false;
  private diagnosticSubprocess?: CodexDiscoverySubprocessModule;
  private modelLoadPromise?: Promise<void>;
  private selectionToken = 0;
  private displayState: DisplayState = { kind: "closed", token: 0 };
  private viewState: SidebarState;
  private readonly readerToolbar: ReaderToolbarController;
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly listeners: Array<() => void> = [];

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    const label = getSelectedItemTitle(this.win);
    this.viewState = createInitialSidebarState(label);
    this.readerToolbar = new ReaderToolbarController({
      pluginID: config.addonID,
      isDestroyed: () => this.destroyed,
      isOpenForReader: (reader) => this.open && this.isCurrentReader(reader),
      onToggle: (reader) => this.toggle(reader),
    });
  }

  mount(): void {
    this.injectStylesheet();
    this.readerToolbar.mount();
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
    this.reactHost?.unmount();
    this.reactHost = undefined;
    this.appMount = undefined;
    this.styleNode?.remove();
    this.readerToolbar.destroy();
    this.shell?.remove();
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
    if (this.open && getSelectedPDFReader(this.win)) {
      this.attachPanel();
    } else {
      this.shell?.remove();
    }
    this.readerToolbar.refresh();
  }

  private openZopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    const token = ++this.selectionToken;
    this.setOpen(true);
    if (isPDFReader(reader)) {
      void this.loadReaderConversation(reader, token);
      return;
    }
    const selectedReader = getSelectedPDFReader(this.win);
    if (selectedReader) {
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
      const conversation =
        await getConversationStore().getOrCreateLatestWorkspaceConversation(
          workspace,
        );
      if (!this.canCommitSelection(token)) {
        return;
      }
      this.setDisplayState({
        kind: "ready",
        token,
        reader,
        workspace,
        conversation,
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

  private mountPanel(): void {
    if (this.shell) {
      void this.ensureReactHost();
      return;
    }

    this.doc.getElementById(SIDEBAR_ID)?.remove();

    this.shell = this.createShell();
    this.appMount = this.doc.createElementNS(HTML_NS, "div") as HTMLElement;
    this.appMount.className = "zp-react-root";
    this.shell.appendChild(this.appMount);
    void this.ensureReactHost();
  }

  private ensureReactHost(): void {
    if (this.reactHost || this.reactHostLoading || !this.appMount) {
      return;
    }

    const mountNode = this.appMount;
    this.reactHostLoading = true;
    void this.createReactHost(mountNode);
  }

  private async createReactHost(mountNode: HTMLElement): Promise<void> {
    try {
      if (this.destroyed || this.appMount !== mountNode) {
        return;
      }
      const reactHost = await createSidebarReactHost(mountNode);
      if (this.destroyed || this.appMount !== mountNode) {
        reactHost.unmount();
        return;
      }
      this.reactHost = reactHost;
      this.renderApp();
    } catch (error) {
      logger.error("failed to mount Zopilot React sidebar", error);
    } finally {
      this.reactHostLoading = false;
    }
  }

  private createShell(): XUL.Box {
    const shell = this.doc.createXULElement("box") as XUL.Box;
    const width = this.getInitialShellWidth();
    shell.id = SIDEBAR_ID;
    shell.setAttribute("orient", "vertical");
    shell.setAttribute("width", String(width));
    shell.style.width = `${width}px`;
    shell.style.flexBasis = `${width}px`;
    return shell;
  }

  private startResize(event: PointerEvent): void {
    const shell = this.shell;
    if (event.button !== 0 || !shell) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const splitter = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = this.getShellWidth();
    const isRtl = Boolean((Zotero as unknown as { rtl?: boolean }).rtl);

    shell.toggleAttribute("data-resizing", true);
    try {
      splitter.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer events used in runtime verification may not have an
      // active pointer capture target. Real mouse drags still take this path.
    }

    const cleanupResize = () => {
      shell.removeAttribute("data-resizing");
      this.win.removeEventListener("pointermove", onPointerMove, true);
      this.win.removeEventListener("pointerup", stopResize, true);
      this.win.removeEventListener("pointercancel", stopResize, true);
    };

    const releasePointerCapture = () => {
      try {
        splitter.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignore stale synthetic pointer ids during verification.
      }
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) {
        return;
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const delta = isRtl
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const resized = this.setShellWidth(startWidth + delta);
      if (!resized) {
        releasePointerCapture();
        cleanupResize();
      }
    };

    const stopResize = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) {
        return;
      }
      endEvent.preventDefault();
      endEvent.stopPropagation();
      releasePointerCapture();
      this.persistShellWidth();
      cleanupResize();
    };

    this.win.addEventListener("pointermove", onPointerMove, true);
    this.win.addEventListener("pointerup", stopResize, true);
    this.win.addEventListener("pointercancel", stopResize, true);
  }

  private getShellWidth(): number {
    const width =
      this.shell?.getBoundingClientRect().width ||
      Number(this.shell?.getAttribute("width")) ||
      DEFAULT_SIDEBAR_WIDTH;
    return Math.round(width);
  }

  private setShellWidth(width: number): boolean {
    if (!this.shell) {
      return false;
    }
    const decision = resolveSidebarResizeWidth(width, this.getViewportWidth());
    if (decision.action === "close") {
      this.setOpen(false);
      return false;
    }
    this.shell.setAttribute("width", String(decision.width));
    this.shell.style.width = `${decision.width}px`;
    this.shell.style.flexBasis = `${decision.width}px`;
    return true;
  }

  private persistShellWidth(): void {
    const width = this.getShellWidth();
    if (width <= this.getCollapseThreshold()) {
      return;
    }
    setPref("sidebar.width", width);
  }

  private getInitialShellWidth(): number {
    return getInitialSidebarWidth(
      getPref("sidebar.width"),
      this.getViewportWidth(),
    );
  }

  private getCollapseThreshold(): number {
    return getSidebarCollapseThreshold(this.getViewportWidth());
  }

  private getViewportWidth(): number {
    return this.doc.documentElement?.clientWidth || this.win.innerWidth || 1024;
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

  private async submitPromptAsync(value: string): Promise<void> {
    const promptText = value.trim();
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
      },
    );
    this.setReadyConversation(conversation);
    const runningTurn: RunningTurn = {
      conversation,
      assistantOutput: "",
      model: this.viewState.selectedModel,
      reasoningEffort: this.viewState.selectedReasoningEffort,
      interrupting: false,
      interrupted: false,
    };
    this.runningTurns.set(conversation.metadata.id, runningTurn);
    this.renderDisplayState();

    try {
      const bridge = getCodexBridge();
      let pendingToolBoundary = false;
      const result = await bridge.sendPrompt(promptText, {
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
      });
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

  private toggle(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.open) {
      if (reader && !this.isCurrentReader(reader)) {
        this.openZopilotPane(reader);
        return;
      }
      this.setOpen(false);
    } else {
      this.openZopilotPane(reader);
    }
  }

  private setOpen(open: boolean): void {
    const wasOpen = this.open;
    this.open = open;
    if (open) {
      this.attachPanel();
    } else {
      this.selectionToken++;
      this.displayState = { kind: "closed", token: this.selectionToken };
      this.hideSessionPopover();
      this.updateViewState({ busy: false, composerEnabled: false });
      this.shell?.remove();
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

  private attachPanel(): void {
    if (!getSelectedPDFReader(this.win)) {
      return;
    }
    this.mountPanel();
    const host = this.doc.getElementById("tabs-deck")?.parentElement;
    if (!host || !this.shell || this.shell.isConnected) {
      return;
    }
    host.append(this.shell);
  }

  private focusComposer(): void {
    this.win.requestAnimationFrame(() => {
      this.updateViewState({ focusToken: this.viewState.focusToken + 1 });
    });
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
      if (target && this.shell?.contains(target)) {
        return;
      }
      this.hideSessionPopover();
    };
    this.doc.addEventListener("click", dismiss);
    this.listeners.push(() => this.doc.removeEventListener("click", dismiss));
  }

  private bindSelectionCopy(): void {
    const copySelection = (event: ClipboardEvent) => {
      const text = getSidebarSelectionText(this.win, this.shell);
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
    this.reactHost?.render(this.viewState, {
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
      selectModel: (model) => this.selectModel(model),
      selectReasoningEffort: (effort) => this.selectReasoningEffort(effort),
      startResize: (event) => this.startResize(event),
      submitPrompt: (text) => {
        void this.submitPromptAsync(text);
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

type SidebarResizeWidthDecision =
  | { action: "close" }
  | { action: "resize"; width: number };

function getSidebarCollapseThreshold(viewportWidth: number): number {
  return viewportWidth <= COMPACT_VIEWPORT_WIDTH
    ? COMPACT_COLLAPSE_THRESHOLD
    : DEFAULT_COLLAPSE_THRESHOLD;
}

function getInitialSidebarWidth(
  storedWidth: unknown,
  viewportWidth: number,
): number {
  const threshold = getSidebarCollapseThreshold(viewportWidth);
  const parsedWidth = Number(storedWidth);
  if (Number.isFinite(parsedWidth) && parsedWidth > threshold) {
    return Math.round(parsedWidth);
  }
  return DEFAULT_SIDEBAR_WIDTH;
}

function resolveSidebarResizeWidth(
  width: number,
  viewportWidth: number,
): SidebarResizeWidthDecision {
  const nextWidth = Math.round(width);
  if (nextWidth <= getSidebarCollapseThreshold(viewportWidth)) {
    return { action: "close" };
  }
  return { action: "resize", width: nextWidth };
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
