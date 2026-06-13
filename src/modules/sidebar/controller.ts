import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
import { getCodexBridge } from "../../codex/bridge";
import type { Conversation, PaperIdentity } from "../../shared/conversation";
import { createPaperIdentity } from "../../shared/conversation";
import { getConversationStore } from "../../store/conversationStore";
import { getPref, setPref } from "../../utils/prefs";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import { getSelectedPDFReader, isPDFReader } from "../../zotero/reader";
import { createSidebarReactHost, type SidebarReactHost } from "./app/reactHost";
import type {
  SidebarContextView,
  SidebarModelView,
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
const CODEX_TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";
export { registerSidebar, unregisterSidebar, unregisterAllSidebars };

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
  private activeReader?: _ZoteroTypes.ReaderInstance;
  private activePaper?: PaperIdentity;
  private activeConversation?: Conversation;
  private open = false;
  private destroyed = false;
  private prewarmPromise?: Promise<void>;
  private contextLoadId = 0;
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
    this.bindSessionPopoverDismiss();
    this.refreshContext();
    void this.loadModels();
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
    const title = this.getDisplayTitle(reader || this.activeReader);
    this.updateViewState({
      title,
      context: this.getContextView(title),
    });
    this.updateSessionControls();
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
    const pdfReader = isPDFReader(reader)
      ? reader
      : getSelectedPDFReader(this.win);
    if (!pdfReader) {
      this.setOpen(false);
      return;
    }

    this.activeReader = pdfReader;
    this.setOpen(true);
    void this.loadActiveConversation(pdfReader);
  }

  private prewarmCodexBridge(): void {
    this.prewarmPromise ??= getCodexBridge()
      .prewarm()
      .catch((error) => {
        ztoolkit.log("codex prewarm failed", String(error));
      })
      .finally(() => {
        this.prewarmPromise = undefined;
      });
  }

  private async loadActiveConversation(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<void> {
    if (!this.open || this.destroyed) {
      return;
    }

    const loadId = ++this.contextLoadId;
    this.renderStatusMessage(getString("sidebar-loading-conversation"));

    const gateway = new ZoteroContextGateway(this.win);
    const scope = await gateway.getActivePaper(reader || this.activeReader);
    if (loadId !== this.contextLoadId || this.destroyed || !this.open) {
      return;
    }
    const paper = scope ? createPaperIdentity(scope) : null;
    if (!paper) {
      this.activePaper = undefined;
      this.activeConversation = undefined;
      this.hideSessionPopover();
      this.refreshContext(reader);
      this.renderStatusMessage(getString("sidebar-unavailable-message"));
      this.updateViewState({ composerEnabled: false });
      return;
    }

    try {
      const conversation =
        await getConversationStore().getOrCreateLatestPaperConversation(paper);
      if (loadId !== this.contextLoadId || this.destroyed || !this.open) {
        return;
      }
      this.activePaper = paper;
      this.activeConversation = conversation;
      this.hideSessionPopover();
      this.refreshContext(reader);
      this.renderConversation(conversation);
    } catch (error) {
      if (loadId !== this.contextLoadId || this.destroyed || !this.open) {
        return;
      }
      this.activePaper = undefined;
      this.activeConversation = undefined;
      this.hideSessionPopover();
      this.refreshContext(reader);
      this.renderStatusMessage(formatCodexError(error));
      this.updateViewState({ composerEnabled: false });
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
      ztoolkit.log("failed to mount Zopilot React sidebar", error);
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

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) {
        return;
      }
      moveEvent.preventDefault();
      moveEvent.stopPropagation();
      const delta = isRtl
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      this.setShellWidth(startWidth + delta);
    };

    const stopResize = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== event.pointerId) {
        return;
      }
      endEvent.preventDefault();
      endEvent.stopPropagation();
      try {
        splitter.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignore stale synthetic pointer ids during verification.
      }
      this.persistShellWidth();
      shell.removeAttribute("data-resizing");
      this.win.removeEventListener("pointermove", onPointerMove, {
        capture: true,
      });
      this.win.removeEventListener("pointerup", stopResize, { capture: true });
      this.win.removeEventListener("pointercancel", stopResize, {
        capture: true,
      });
    };

    this.win.addEventListener("pointermove", onPointerMove, { capture: true });
    this.win.addEventListener("pointerup", stopResize, { capture: true });
    this.win.addEventListener("pointercancel", stopResize, { capture: true });
  }

  private getShellWidth(): number {
    const width =
      this.shell?.getBoundingClientRect().width ||
      Number(this.shell?.getAttribute("width")) ||
      DEFAULT_SIDEBAR_WIDTH;
    return Math.round(width);
  }

  private setShellWidth(width: number): void {
    if (!this.shell) {
      return;
    }
    const { min, max } = this.getShellWidthBounds();
    const nextWidth = clamp(Math.round(width), min, max);
    this.shell.setAttribute("width", String(nextWidth));
    this.shell.style.width = `${nextWidth}px`;
    this.shell.style.flexBasis = `${nextWidth}px`;
  }

  private persistShellWidth(): void {
    const { min, max } = this.getShellWidthBounds();
    setPref("sidebar.width", clamp(this.getShellWidth(), min, max));
  }

  private getInitialShellWidth(): number {
    const storedWidth = Number(getPref("sidebar.width"));
    const { min, max } = this.getShellWidthBounds();
    return clamp(
      Number.isFinite(storedWidth) ? storedWidth : DEFAULT_SIDEBAR_WIDTH,
      min,
      max,
    );
  }

  private getShellWidthBounds(): { min: number; max: number } {
    const viewportWidth =
      this.doc.documentElement?.clientWidth || this.win.innerWidth || 1024;
    const min = viewportWidth <= 860 ? 280 : 300;
    const maxByViewport =
      viewportWidth <= 860
        ? Math.floor(viewportWidth * 0.58)
        : Math.floor(Math.min(520, viewportWidth * 0.48));
    return { min, max: Math.max(min, maxByViewport) };
  }

  private async toggleSessionPopover(): Promise<void> {
    if (!this.activePaper || !this.viewState.composerEnabled) {
      return;
    }
    if (this.viewState.sessionsOpen) {
      this.hideSessionPopover();
      return;
    }
    await this.showSessionPopover();
  }

  private async showSessionPopover(): Promise<void> {
    if (!this.activePaper) {
      return;
    }
    const paperKey = this.activePaper.paperKey;
    const conversations =
      await getConversationStore().listPaperConversations(paperKey);
    if (
      this.destroyed ||
      !this.open ||
      this.activePaper?.paperKey !== paperKey
    ) {
      return;
    }
    this.updateViewState({
      sessions: conversations.map((conversation) =>
        createSessionView(conversation, this.activeConversation?.metadata.id),
      ),
      sessionsOpen: true,
    });
  }

  private hideSessionPopover(): void {
    if (!this.viewState.sessionsOpen && !this.viewState.sessions.length) {
      return;
    }
    this.updateViewState({ sessionsOpen: false, sessions: [] });
  }

  private async createNewSession(): Promise<void> {
    if (!this.activePaper) {
      return;
    }
    const conversation = await getConversationStore().createPaperConversation(
      this.activePaper,
    );
    this.activeConversation = conversation;
    this.hideSessionPopover();
    this.refreshContext();
    this.renderConversation(conversation);
    this.focusComposer();
  }

  private async switchSession(conversation: Conversation): Promise<void> {
    if (!this.activePaper) {
      return;
    }
    const active = await getConversationStore().activatePaperConversation(
      conversation.metadata,
    );
    if (
      this.destroyed ||
      !this.open ||
      this.activePaper.paperKey !== active.metadata.paperKey
    ) {
      return;
    }
    this.activeConversation = active;
    this.hideSessionPopover();
    this.refreshContext();
    this.renderConversation(active);
    this.focusComposer();
  }

  private async archiveSession(conversation: Conversation): Promise<void> {
    if (!this.activePaper) {
      return;
    }
    const paper = this.activePaper;
    const running = this.runningTurns.get(conversation.metadata.id);
    if (running) {
      this.interruptRunningTurn(running);
    }
    await getConversationStore().archivePaperConversation(
      conversation.metadata,
    );
    if (
      this.destroyed ||
      !this.open ||
      this.activePaper?.paperKey !== paper.paperKey
    ) {
      return;
    }

    if (this.activeConversation?.metadata.id === conversation.metadata.id) {
      const next =
        (await getConversationStore().getLatestPaperConversation(
          paper.paperKey,
        )) || (await getConversationStore().createPaperConversation(paper));
      this.activeConversation = next;
      this.refreshContext();
      this.renderConversation(next);
    }

    await this.showSessionPopover();
  }

  private async submitPromptAsync(value: string): Promise<void> {
    const promptText = value.trim();
    if (!promptText) {
      return;
    }

    let conversation = this.activeConversation;
    if (!conversation) {
      await this.loadActiveConversation(this.activeReader);
      conversation = this.activeConversation;
    }
    if (!conversation) {
      this.renderStatusMessage(getString("sidebar-unavailable-message"));
      this.updateViewState({ composerEnabled: false });
      return;
    }
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
    this.activeConversation = conversation;
    const runningTurn: RunningTurn = {
      conversation,
      assistantOutput: "",
      model: this.viewState.selectedModel,
      reasoningEffort: this.viewState.selectedReasoningEffort,
      interrupting: false,
      interrupted: false,
    };
    this.runningTurns.set(conversation.metadata.id, runningTurn);
    this.renderConversation(conversation);
    this.refreshContext();

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
      this.activeConversation?.metadata.id !==
      runningTurn.conversation.metadata.id
    ) {
      return;
    }
    this.renderConversation(runningTurn.conversation);
  }

  private finishRunningTurn(
    runningTurn: RunningTurn,
    conversation: Conversation,
  ): void {
    const conversationId = runningTurn.conversation.metadata.id;
    this.runningTurns.delete(conversationId);
    if (this.activeConversation?.metadata.id === conversationId) {
      this.activeConversation = conversation;
      this.renderConversation(conversation);
    }
    if (this.viewState.sessionsOpen) {
      void this.showSessionPopover();
    }
  }

  private interruptActiveTurn(): void {
    const conversationId = this.activeConversation?.metadata.id;
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
        ztoolkit.log("codex turn/interrupt failed", String(error));
      });
  }

  private async loadModels(): Promise<void> {
    try {
      const models = await getCodexBridge().listModels();
      const availableModels = models.length ? models : [DEFAULT_MODEL];
      const preferredModel = String(getPref("codex.model") || "");
      const selectedModel = availableModels.some(
        (model) => model.slug === preferredModel,
      )
        ? preferredModel
        : availableModels[0]?.slug || DEFAULT_MODEL.slug;
      this.updateModelSelection(availableModels, selectedModel);
    } catch (error) {
      ztoolkit.log("codex model/list failed", String(error));
      this.updateModelSelection([DEFAULT_MODEL], DEFAULT_MODEL.slug);
    }
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
    const conversationId = this.activeConversation?.metadata.id;
    const runningTurn = conversationId
      ? this.runningTurns.get(conversationId)
      : undefined;
    this.updateViewState({
      busy: Boolean(runningTurn),
    });
  }

  private renderConversation(conversation: Conversation): void {
    const runningTurn = this.runningTurns.get(conversation.metadata.id);
    this.updateViewState({
      composerEnabled: true,
      messages: createConversationMessages(
        conversation,
        runningTurn
          ? {
              text: runningTurn.assistantOutput,
              interrupted: runningTurn.interrupted,
              running: !runningTurn.interrupted,
            }
          : undefined,
      ),
      busy: Boolean(runningTurn),
    });
  }

  private renderStatusMessage(markdown: string): void {
    this.updateViewState({
      busy: false,
      messages: [
        {
          id: `zp-status-${this.contextLoadId}`,
          role: "assistant",
          text: markdown,
          status: "complete",
          transient: true,
        },
      ],
    });
  }

  private updateSessionControls(): void {
    if (!this.activePaper) {
      this.hideSessionPopover();
    } else if (this.viewState.sessionsOpen) {
      this.updateViewState({
        sessions: this.viewState.sessions.map((session) =>
          createSessionView(
            session.conversation,
            this.activeConversation?.metadata.id,
          ),
        ),
      });
    }
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
      this.activeReader = undefined;
      this.activePaper = undefined;
      this.activeConversation = undefined;
      this.hideSessionPopover();
      this.updateViewState({ busy: false, composerEnabled: false });
      this.shell?.remove();
    }
    this.readerToolbar.refresh();
    this.refreshContext();
    this.win.requestAnimationFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });

    if (open) {
      if (!wasOpen) {
        this.prewarmCodexBridge();
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
    if (this.activeReader?.itemID === reader.itemID) {
      return true;
    }
    const attachmentKey = this.activePaper?.attachmentKey;
    if (!attachmentKey || reader.itemID === undefined) {
      return false;
    }
    return Zotero.Items.get(reader.itemID)?.key === attachmentKey;
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

  private syncWithSelectedPDFReader(): void {
    const selectedReader = getSelectedPDFReader(this.win);
    if (!selectedReader) {
      if (this.open) {
        this.setOpen(false);
      } else {
        this.activeReader = undefined;
        this.refreshContext();
        this.readerToolbar.refresh();
      }
      return;
    }

    this.activeReader = selectedReader;
    if (this.open) {
      void this.loadActiveConversation(selectedReader);
    } else {
      this.refreshContext(selectedReader);
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

  private getDisplayTitle(reader?: _ZoteroTypes.ReaderInstance): string {
    if (this.activeConversation) {
      return `${this.activeConversation.metadata.title} / ${this.activeConversation.metadata.label}`;
    }
    return getSelectedItemTitle(this.win, reader);
  }

  private getContextView(label: string): SidebarContextView {
    if (!this.activePaper) {
      return { label };
    }
    return {
      label,
      paperTitle: this.activePaper.title,
      paperKey: this.activePaper.paperKey,
      parentItemKey: this.activePaper.parentItemKey,
      attachmentKey: this.activePaper.attachmentKey,
    };
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
      toggleSessions: () => {
        void this.toggleSessionPopover();
      },
    });
  }
}

function hasStylesheet(doc: Document, uri: string): boolean {
  return Array.from(doc.childNodes).some((node) => {
    return (
      node !== null && node.nodeType === 7 && node.nodeValue?.includes(uri)
    );
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
