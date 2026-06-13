import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
import { getCodexBridge } from "../../codex/bridge";
import { buildPaperQuestionPrompt } from "../../codex/promptBuilder";
import type { Conversation, PaperIdentity } from "../../shared/conversation";
import { createPaperIdentity } from "../../shared/conversation";
import { getConversationStore } from "../../store/conversationStore";
import { getPref, setPref } from "../../utils/prefs";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import { createSidebarReactHost, type SidebarReactHost } from "./app/reactHost";
import type {
  SidebarContextView,
  SidebarMessageView,
  SidebarModelView,
  SidebarSessionView,
  SidebarState,
} from "./app/types";
import {
  HTML_NS,
  READER_TOOLBAR_BUTTON_ID,
  SIDEBAR_ID,
  STYLE_URI,
} from "./constants";
import { createReaderToolbarButton } from "./readerToolbar";
import { getSelectedItemTitle } from "./selectedItem";

const controllers = new WeakMap<Window, SidebarController>();
const LEGACY_TOOLBAR_TOGGLE_BUTTON_ID = "zotero-copilot-sidebar-toolbar-toggle";
const DEFAULT_SIDEBAR_WIDTH = 372;
const DEFAULT_CONTEXT_PANE_WIDTH = 357;
const MAX_REASONABLE_NATIVE_PANE_WIDTH = 900;
const ZOTERO_PANE_PERSIST_PREF = "pane.persist";
const CODEX_TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";
const DEFAULT_MODEL: SidebarModelView = {
  slug: "gpt-5.5",
  displayName: "GPT-5.5",
  supportedReasoningEfforts: ["medium"],
  defaultReasoningEffort: "medium",
};

export {
  cleanupPersistedSidebarPaneState,
  registerSidebar,
  unregisterSidebar,
  unregisterAllSidebars,
};

type PanePersistState = Record<string, Record<string, string>>;
type PromptDebugWindow = Window & {
  // Development-only snapshot for inspecting the full prompt in Zotero's console.
  __zcpLastPrompt?: string;
  __zcpReactHostStatus?: string;
};

type RunningTurn = {
  conversationId: string;
  conversation: Conversation;
  assistantOutput: string;
  model?: string;
  reasoningEffort?: string;
  threadId?: string;
  turnId?: string;
  interrupting: boolean;
  interrupted: boolean;
};

function cleanupPersistedSidebarPaneState(): void {
  const rawPersist = Zotero.Prefs.get(ZOTERO_PANE_PERSIST_PREF);
  if (typeof rawPersist !== "string" || !rawPersist) {
    return;
  }

  try {
    const persist = JSON.parse(rawPersist) as PanePersistState;
    if (!Object.prototype.hasOwnProperty.call(persist, SIDEBAR_ID)) {
      return;
    }

    delete persist[SIDEBAR_ID];

    const contextPane = persist["zotero-context-pane"];
    const contextWidth = Number(contextPane?.width);
    if (contextPane && contextWidth > MAX_REASONABLE_NATIVE_PANE_WIDTH) {
      contextPane.width = String(DEFAULT_CONTEXT_PANE_WIDTH);
    }

    Zotero.Prefs.set(ZOTERO_PANE_PERSIST_PREF, JSON.stringify(persist));
  } catch (error) {
    Zotero.debug(
      `[${config.addonName}] failed to clean persisted sidebar pane state: ${String(
        error,
      )}`,
    );
  }
}

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
  private composerEnabled = false;
  private destroyed = false;
  private prewarmPromise?: Promise<void>;
  private contextLoadId = 0;
  private viewState: SidebarState;
  private readonly runningTurns = new Map<string, RunningTurn>();
  private readonly listeners: Array<() => void> = [];
  private readonly readerToolbarButtons = new Set<Element>();
  private readonly readerToolbarButtonReaders = new WeakMap<
    Element,
    _ZoteroTypes.ReaderInstance
  >();
  private readonly readerToolbarHandler: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> =
    (event) => this.renderReaderToolbarButton(event);

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
    const label = this.getSelectedItemTitle();
    this.viewState = createInitialSidebarState(label);
  }

  mount(): void {
    this.injectStylesheet();
    this.registerReaderToolbarButtons();
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
    this.removeMainWindowToolbarToggleButton();
    this.removeReaderToolbarButtons();
    this.shell?.remove();
  }

  refreshContext(
    reader?: _ZoteroTypes.ReaderInstance,
    item?: Zotero.Item,
  ): void {
    const title = this.getDisplayTitle(reader || this.activeReader, item);
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
    this.removeMainWindowToolbarToggleButton();
    if (this.open) {
      this.attachPanel();
    }
    this.updateToggleButtons();
  }

  private registerReaderToolbarButtons(): void {
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      this.readerToolbarHandler,
      config.addonID,
    );
    this.listeners.push(() => {
      this.unregisterReaderToolbarButtons();
    });
    this.mountOpenReaderToolbarButtons();
  }

  private removeMainWindowToolbarToggleButton(): void {
    this.doc.getElementById(LEGACY_TOOLBAR_TOGGLE_BUTTON_ID)?.remove();
  }

  private renderReaderToolbarButton(
    event: _ZoteroTypes.Reader.EventParams<"renderToolbar">,
  ): void {
    this.mountReaderToolbarButton(event.reader, event.doc, event.append);
  }

  private mountOpenReaderToolbarButtons(): void {
    const readers = (
      Zotero.Reader as unknown as { _readers?: _ZoteroTypes.ReaderInstance[] }
    )._readers;
    readers?.forEach((reader) => {
      void reader._initPromise?.then(() => {
        if (this.destroyed) {
          return;
        }
        this.mountReaderToolbarButton(reader);
      });
    });
  }

  private mountReaderToolbarButton(
    reader: _ZoteroTypes.ReaderInstance,
    doc = reader._iframeWindow?.document,
    append?: (button: HTMLButtonElement) => void,
  ): void {
    if (
      this.destroyed ||
      !doc ||
      doc.getElementById(READER_TOOLBAR_BUTTON_ID)
    ) {
      return;
    }

    const toolbar = append ? undefined : this.getReaderToolbar(doc);
    if (!append && !toolbar) {
      return;
    }

    const button = createReaderToolbarButton(doc, this.open, () =>
      this.toggle(reader),
    );

    this.readerToolbarButtons.add(button);
    this.readerToolbarButtonReaders.set(button, reader);
    doc.defaultView?.addEventListener(
      "unload",
      () => this.readerToolbarButtons.delete(button),
      { once: true },
    );
    this.updateReaderToolbarButton(button);
    if (append) {
      append(button);
    } else {
      toolbar?.append(button);
    }
    this.positionReaderToolbarButton(doc, button);
  }

  private getReaderToolbar(doc?: Document): Element | undefined {
    return (
      doc?.querySelector(".toolbar .end") ||
      doc?.querySelector(".toolbar") ||
      undefined
    );
  }

  private positionReaderToolbarButton(
    doc: Document,
    button: HTMLButtonElement,
  ): void {
    const anchor =
      doc.querySelector(".toolbar .end .context-pane-toggle") ||
      doc.querySelector(".toolbar .end .find");
    anchor?.parentNode?.insertBefore(button, anchor.nextSibling);
  }

  private unregisterReaderToolbarButtons(): void {
    const unregisterByPluginID = (
      Zotero.Reader as unknown as {
        _unregisterEventListenerByPluginID?: (pluginID: string) => void;
      }
    )._unregisterEventListenerByPluginID;
    unregisterByPluginID?.call(Zotero.Reader, config.addonID);
  }

  private removeReaderToolbarButtons(): void {
    this.readerToolbarButtons.forEach((button) => button.remove());
    this.readerToolbarButtons.clear();

    const readers = (
      Zotero.Reader as unknown as { _readers?: _ZoteroTypes.ReaderInstance[] }
    )._readers;
    readers?.forEach((reader) => {
      reader._iframeWindow?.document
        ?.getElementById(READER_TOOLBAR_BUTTON_ID)
        ?.remove();
    });
  }

  private openCopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    this.activeReader = reader;
    this.ensureMountedSurfaces();
    this.setOpen(true);
    void this.loadActiveConversation(reader);
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
      this.renderUnavailable();
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
      this.setComposerEnabled(false);
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
    this.appMount.className = "zcp-react-root";
    this.shell.appendChild(this.appMount);
    void this.ensureReactHost();
  }

  private ensureReactHost(): void {
    if (this.reactHost || this.reactHostLoading || !this.appMount) {
      return;
    }

    const mountNode = this.appMount;
    this.reactHostLoading = true;
    this.storeReactHostStatus("loading");
    void this.createReactHost(mountNode);
  }

  private async createReactHost(mountNode: HTMLElement): Promise<void> {
    try {
      if (this.destroyed || this.appMount !== mountNode) {
        this.storeReactHostStatus("stale");
        return;
      }
      this.storeReactHostStatus("creating");
      const reactHost = await createSidebarReactHost(mountNode);
      if (this.destroyed || this.appMount !== mountNode) {
        reactHost.unmount();
        this.storeReactHostStatus("stale");
        return;
      }
      this.reactHost = reactHost;
      this.storeReactHostStatus("rendering");
      this.renderApp();
      this.storeReactHostStatus("ready");
    } catch (error) {
      this.storeReactHostStatus(`error: ${formatUnknownError(error)}`);
      this.renderReactHostFallback(error);
      ztoolkit.log("failed to mount Zotero Copilot React sidebar", error);
    } finally {
      this.reactHostLoading = false;
    }
  }

  private getSidebarHost(): Element | null {
    return this.doc.getElementById("tabs-deck")?.parentElement || null;
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
    if (!this.activePaper || !this.composerEnabled) {
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
        this.createSessionView(conversation),
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

  private submitPrompt(value: string): void {
    void this.submitPromptAsync(value);
  }

  private async submitPromptAsync(value: string): Promise<void> {
    const promptText = value.trim();
    if (!promptText) {
      return;
    }

    let conversation =
      this.activeConversation || (await this.reloadConversationForSubmit());
    if (!conversation) {
      this.renderUnavailable();
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
    this.renderConversation(conversation);
    const runningTurn: RunningTurn = {
      conversationId: conversation.metadata.id,
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
    this.updateRunningState();

    try {
      let hasAssistantText = false;
      const bridge = getCodexBridge();
      const prompt = buildPaperQuestionPrompt(promptText);
      let pendingToolBoundary = false;
      this.storePromptDebugSnapshot(prompt);
      const result = await bridge.sendPrompt(prompt, {
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
        onDelta: (delta, fullText) => {
          if (runningTurn.interrupted) {
            return;
          }
          hasAssistantText = Boolean(fullText);
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
          if (!hasAssistantText && !runningTurn.interrupted) {
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

  private async reloadConversationForSubmit(): Promise<Conversation | null> {
    await this.loadActiveConversation(this.activeReader);
    return this.activeConversation || null;
  }

  private refreshRunningTurnView(runningTurn: RunningTurn): void {
    if (this.activeConversation?.metadata.id !== runningTurn.conversationId) {
      return;
    }
    this.renderConversation(runningTurn.conversation);
  }

  private finishRunningTurn(
    runningTurn: RunningTurn,
    conversation: Conversation,
  ): void {
    this.runningTurns.delete(runningTurn.conversationId);
    if (this.activeConversation?.metadata.id === runningTurn.conversationId) {
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
    this.updateViewState({ modelLoading: true });
    try {
      const models = await getCodexBridge().listModels();
      this.applyModels(models.length ? models : [DEFAULT_MODEL]);
    } catch (error) {
      ztoolkit.log("codex model/list failed", String(error));
      this.applyModels([DEFAULT_MODEL]);
    } finally {
      this.updateViewState({ modelLoading: false });
    }
  }

  private applyModels(models: SidebarModelView[]): void {
    const preferredModel = String(getPref("codex.model") || "");
    const selectedModel = models.some((model) => model.slug === preferredModel)
      ? preferredModel
      : models[0]?.slug || DEFAULT_MODEL.slug;
    this.updateModelSelection(models, selectedModel);
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
    let messages = conversation.messages.length
      ? conversation.messages.map(toMessageView)
      : [
          {
            id: "zcp-welcome-message",
            role: "assistant" as const,
            text: getString("sidebar-welcome-message"),
            status: "complete" as const,
          },
        ];
    const runningTurn = this.runningTurns.get(conversation.metadata.id);
    if (runningTurn) {
      messages = [
        ...messages.filter(
          (message) =>
            message.id !== getStreamingMessageId(conversation.metadata.id),
        ),
        {
          id: getStreamingMessageId(conversation.metadata.id),
          role: "assistant" as const,
          text:
            runningTurn.assistantOutput || getString("sidebar-codex-starting"),
          status: runningTurn.interrupted
            ? ("interrupted" as const)
            : ("complete" as const),
          transient: true,
          running: !runningTurn.interrupted,
          model: runningTurn.model,
          reasoningEffort: runningTurn.reasoningEffort,
        },
      ];
    }
    this.setComposerEnabled(true);
    this.updateViewState({
      messages,
      busy: Boolean(runningTurn),
    });
  }

  private renderUnavailable(): void {
    this.renderStatusMessage(getString("sidebar-unavailable-message"));
    this.setComposerEnabled(false);
  }

  private renderStatusMessage(markdown: string): void {
    this.updateViewState({
      busy: false,
      messages: [
        {
          id: `zcp-status-${this.contextLoadId}`,
          role: "assistant",
          text: markdown,
          status: "complete",
          transient: true,
        },
      ],
    });
  }

  private storePromptDebugSnapshot(prompt: string): void {
    const debugWin = this.win as PromptDebugWindow;
    debugWin.__zcpLastPrompt = prompt;
  }

  private storeReactHostStatus(status: string): void {
    const debugWin = this.win as PromptDebugWindow;
    debugWin.__zcpReactHostStatus = status;
  }

  private renderReactHostFallback(error: unknown): void {
    const mount = this.appMount;
    if (!mount || this.destroyed) {
      return;
    }

    const aside = this.html("aside", "zcp-sidebar");
    aside.setAttribute("role", "complementary");
    aside.setAttribute("aria-label", getString("sidebar-title"));

    const header = this.html("header", "zcp-sidebar-header");
    const identity = this.html("div", "zcp-sidebar-identity");
    const icon = this.html("span", "zcp-sidebar-icon");
    const titleBlock = this.html("div", "zcp-sidebar-title-block");
    const title = this.html("span", "zcp-sidebar-title");
    title.textContent = getString("sidebar-title");
    const selectedTitle = this.html("span", "zcp-sidebar-selected-title");
    selectedTitle.textContent = getString("sidebar-codex-error");
    titleBlock.append(title, selectedTitle);
    identity.append(icon, titleBlock);

    const closeButton = this.html("button", "zcp-icon-button");
    closeButton.setAttribute("type", "button");
    closeButton.setAttribute("aria-label", getString("sidebar-close"));
    closeButton.title = getString("sidebar-close");
    closeButton.addEventListener("click", () => this.setOpen(false));
    closeButton.appendChild(
      this.html("span", "zcp-action-icon zcp-close-icon"),
    );

    const actions = this.html("div", "zcp-sidebar-actions");
    actions.appendChild(closeButton);
    header.append(identity, actions);

    const log = this.html("main", "zcp-chat-log");
    log.setAttribute("role", "log");
    log.setAttribute("aria-live", "polite");
    const row = this.html("article", "zcp-message zcp-message-assistant");
    row.appendChild(this.html("div", "zcp-message-avatar"));
    const body = this.html("div", "zcp-message-body");
    const message = this.html("p");
    message.textContent = formatCodexError(error);
    body.appendChild(message);
    row.appendChild(body);
    log.appendChild(row);

    aside.append(header, log);
    mount.replaceChildren(aside);
  }

  private setComposerEnabled(enabled: boolean): void {
    this.composerEnabled = enabled;
    this.updateViewState({ composerEnabled: enabled });
  }

  private updateSessionControls(): void {
    if (!this.activePaper) {
      this.hideSessionPopover();
    } else if (this.viewState.sessionsOpen) {
      this.updateViewState({
        sessions: this.viewState.sessions.map((session) =>
          this.createSessionView(session.conversation),
        ),
      });
    }
  }

  private toggle(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.open) {
      if (reader && !this.isCurrentReader(reader)) {
        this.openCopilotPane(reader);
        return;
      }
      this.setOpen(false);
    } else {
      this.openCopilotPane(reader);
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
      this.setComposerEnabled(false);
      this.updateViewState({ busy: false });
      this.detachPanel();
    }
    this.updateToggleButtons();
    this.refreshContext();
    this.notifyLayoutChanged();

    if (open) {
      if (!wasOpen) {
        this.prewarmCodexBridge();
      }
      this.focusComposer();
    }
  }

  private attachPanel(): void {
    this.mountPanel();
    const host = this.getSidebarHost();
    if (!host || !this.shell || this.shell.isConnected) {
      return;
    }
    host.append(this.shell);
  }

  private detachPanel(): void {
    this.shell?.remove();
  }

  private notifyLayoutChanged(): void {
    this.win.requestAnimationFrame(() => {
      this.win.dispatchEvent(new this.win.Event("resize"));
    });
  }

  private focusComposer(): void {
    this.win.requestAnimationFrame(() => {
      this.updateViewState({ focusToken: this.viewState.focusToken + 1 });
    });
  }

  private updateToggleButtons(): void {
    for (const button of this.readerToolbarButtons) {
      const reader = this.readerToolbarButtonReaders.get(button);
      const active = this.open && (!reader || this.isCurrentReader(reader));
      button?.setAttribute("checked", String(active));
      button?.setAttribute("aria-pressed", String(active));
      if (button) {
        this.updateReaderToolbarButton(button);
      }
    }
  }

  private updateReaderToolbarButton(button: Element): void {
    if (!button.classList.contains("zcp-reader-toolbar-button")) {
      return;
    }
    const reader = this.readerToolbarButtonReaders.get(button);
    const active = this.open && (!reader || this.isCurrentReader(reader));
    button.toggleAttribute("data-active", active);
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
        this.activeReader = undefined;
        if (this.open) {
          void this.loadActiveConversation();
        } else {
          this.refreshContext();
        }
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
        this.refreshContext();
      }, 0);
    };
    const reloadConversationSoon = () => {
      this.win.setTimeout(() => {
        if (this.open) {
          this.activeReader = undefined;
          void this.loadActiveConversation();
        }
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

  private getSelectedItemTitle(
    reader?: _ZoteroTypes.ReaderInstance,
    currentItem?: Zotero.Item,
  ): string {
    return getSelectedItemTitle(this.win, reader, currentItem);
  }

  private html(tagName: string, className?: string): HTMLElement {
    const element = this.doc.createElementNS(HTML_NS, tagName) as HTMLElement;
    if (className) {
      element.className = className;
    }
    return element;
  }

  private getDisplayTitle(
    reader?: _ZoteroTypes.ReaderInstance,
    item?: Zotero.Item,
  ): string {
    if (this.activeConversation) {
      return `${this.activeConversation.metadata.title} / ${this.activeConversation.metadata.label}`;
    }
    return this.getSelectedItemTitle(reader, item);
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

  private createSessionView(conversation: Conversation): SidebarSessionView {
    return {
      id: conversation.metadata.id,
      title: getSessionTitle(conversation),
      meta: formatSessionMeta(conversation),
      active: this.activeConversation?.metadata.id === conversation.metadata.id,
      conversation,
    };
  }

  private openExternalLink(url: string): void {
    if (!isSafeExternalURL(url, this.win)) {
      return;
    }
    Zotero.launchURL(url);
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
      openExternalLink: (url) => this.openExternalLink(url),
      selectModel: (model) => this.selectModel(model),
      selectReasoningEffort: (effort) => this.selectReasoningEffort(effort),
      startResize: (event) => this.startResize(event),
      submitPrompt: (text) => this.submitPrompt(text),
      switchSession: (conversation) => {
        void this.switchSession(conversation);
      },
      toggleSessions: () => {
        void this.toggleSessionPopover();
      },
    });
  }
}

function createInitialSidebarState(label: string): SidebarState {
  return {
    title: label,
    context: { label },
    messages: [
      {
        id: "zcp-welcome-message",
        role: "assistant",
        text: getString("sidebar-welcome-message"),
        status: "complete",
      },
    ],
    sessions: [],
    sessionsOpen: false,
    composerEnabled: false,
    busy: false,
    models: [DEFAULT_MODEL],
    selectedModel: DEFAULT_MODEL.slug,
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: DEFAULT_MODEL.supportedReasoningEfforts,
    modelLoading: false,
    focusToken: 0,
  };
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

function toMessageView(
  message: Conversation["messages"][number],
): SidebarMessageView {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    completedAt: formatBeijingTimestamp(
      message.completedAt || message.createdAt,
    ),
    model: message.model,
    reasoningEffort: message.reasoningEffort,
  };
}

function getStreamingMessageId(conversationId: string): string {
  return `zcp-streaming-assistant-${conversationId}`;
}

function formatBeijingTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return (
    [
      beijing.getUTCFullYear(),
      pad2(beijing.getUTCMonth() + 1),
      pad2(beijing.getUTCDate()),
    ].join("-") +
    ` ${pad2(beijing.getUTCHours())}:${pad2(beijing.getUTCMinutes())}`
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatCodexError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [getString("sidebar-codex-error"), "", "```", message, "```"].join(
    "\n",
  );
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return [
      error.name,
      error.message,
      error.stack ? `\n${error.stack}` : "",
    ].join(": ");
  }
  return String(error);
}

function getSessionTitle(conversation: Conversation): string {
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user",
  );
  return truncateLabel(
    firstUserMessage?.text ||
      conversation.metadata.label ||
      conversation.metadata.createdAt,
    54,
  );
}

function formatSessionMeta(conversation: Conversation): string {
  const preview = conversation.metadata.latestPreview?.trim();
  if (preview) {
    return truncateLabel(preview, 72);
  }
  return new Date(conversation.metadata.createdAt).toLocaleString();
}

function truncateLabel(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function isSafeExternalURL(url: string, win: Window): boolean {
  try {
    const parsed = new win.URL(url);
    return ["https:", "http:", "mailto:", "doi:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
