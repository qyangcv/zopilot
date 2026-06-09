import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
import { getCodexBridge } from "../../codex/bridge";
import { buildPaperQuestionPrompt } from "../../codex/promptBuilder";
import type { Conversation, PaperIdentity } from "../../shared/conversation";
import { createPaperIdentity } from "../../shared/conversation";
import { getConversationStore } from "../../store/conversationStore";
import { getPref, setPref } from "../../utils/prefs";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import {
  HTML_NS,
  ICON_URI,
  READER_TOOLBAR_BUTTON_ID,
  SIDEBAR_ID,
  SPLITTER_ID,
  STYLE_URI,
  TOOLBAR_TOGGLE_BUTTON_ID,
} from "./constants";
import { renderMarkdown } from "./markdown";
import { createReaderToolbarButton } from "./readerToolbar";
import { getSelectedItemTitle } from "./selectedItem";

const controllers = new WeakMap<Window, SidebarController>();
const DEFAULT_SIDEBAR_WIDTH = 372;
const DEFAULT_CONTEXT_PANE_WIDTH = 357;
const MAX_REASONABLE_NATIVE_PANE_WIDTH = 900;
const ZOTERO_PANE_PERSIST_PREF = "pane.persist";
const CODEX_TOOL_OUTPUT_SEPARATOR = "\n\n---\n\n";

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
  private toolbarToggleButton?: Element;
  private splitter?: HTMLElement;
  private shell?: XUL.Box;
  private selectedTitle?: HTMLElement;
  private historyButton?: HTMLButtonElement;
  private newSessionButton?: HTMLButtonElement;
  private sessionPopover?: HTMLElement;
  private contextChipText?: HTMLElement;
  private chatLog?: HTMLElement;
  private composer?: HTMLFormElement;
  private textarea?: HTMLTextAreaElement;
  private sendButton?: HTMLButtonElement;
  private activeReader?: _ZoteroTypes.ReaderInstance;
  private activePaper?: PaperIdentity;
  private activeConversation?: Conversation;
  private open = false;
  private busy = false;
  private composerEnabled = false;
  private destroyed = false;
  private prewarmPromise?: Promise<void>;
  private contextLoadId = 0;
  private readonly listeners: Array<() => void> = [];
  private readonly readerToolbarButtons = new Set<Element>();
  private readonly readerToolbarHandler: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> =
    (event) => this.renderReaderToolbarButton(event);

  constructor(win: Window) {
    this.win = win;
    this.doc = win.document;
  }

  mount(): void {
    this.injectStylesheet();
    this.registerReaderToolbarButtons();
    this.ensureMountedSurfaces();
    this.bindContextRefresh();
    this.bindLayoutRefresh();
    this.bindSessionPopoverDismiss();
    this.refreshContext();
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.splice(0).forEach((dispose) => dispose());
    this.styleNode?.remove();
    this.toolbarToggleButton?.remove();
    this.removeReaderToolbarButtons();
    this.splitter?.remove();
    this.shell?.remove();
  }

  refreshContext(
    reader?: _ZoteroTypes.ReaderInstance,
    item?: Zotero.Item,
  ): void {
    const conversation = this.activeConversation;
    const title = conversation
      ? `${conversation.metadata.title} / ${conversation.metadata.label}`
      : this.getSelectedItemTitle(reader || this.activeReader, item);
    if (this.selectedTitle) {
      this.selectedTitle.textContent = title;
      this.selectedTitle.title = title;
    }
    if (this.contextChipText) {
      this.contextChipText.textContent = title;
      this.contextChipText.title = title;
    }
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
    this.mountToolbarToggleButton();
    this.mountPanel();
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

  private mountToolbarToggleButton(): void {
    if (this.toolbarToggleButton?.isConnected) {
      return;
    }

    const toolbar = this.doc.querySelector("#zotero-items-toolbar");
    if (!toolbar || this.doc.getElementById(TOOLBAR_TOGGLE_BUTTON_ID)) {
      return;
    }

    const button = this.doc.createXULElement("toolbarbutton");
    button.id = TOOLBAR_TOGGLE_BUTTON_ID;
    button.classList.add("zotero-tb-button", "zcp-sidebar-toggle");
    button.setAttribute("tooltiptext", getString("sidebar-toggle-tooltip"));
    button.setAttribute("aria-label", getString("sidebar-toggle-tooltip"));
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("image", ICON_URI);
    button.addEventListener("command", () => this.toggle());

    const itemPaneToggle = this.doc.getElementById(
      "zotero-tb-toggle-item-pane-stacked",
    );
    toolbar.insertBefore(button, itemPaneToggle || null);
    this.toolbarToggleButton = button;
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
  }

  private getReaderToolbar(doc?: Document): Element | undefined {
    return (
      doc?.querySelector(".toolbar .end") ||
      doc?.querySelector(".toolbar") ||
      undefined
    );
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
    if (this.busy) {
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
      return;
    }

    this.doc.getElementById(SIDEBAR_ID)?.remove();

    this.shell = this.createShell();
    this.shell.appendChild(this.createSidebarContent());
  }

  private getSidebarHost(): Element | null {
    return this.doc.getElementById("tabs-deck")?.parentElement || null;
  }

  private createSplitter(): HTMLElement {
    const splitter = this.html("div", "zcp-resize-handle");
    splitter.id = SPLITTER_ID;
    splitter.setAttribute("aria-hidden", "true");
    splitter.addEventListener("pointerdown", (event) =>
      this.startResize(event as PointerEvent),
    );
    return splitter;
  }

  private createShell(): XUL.Box {
    const shell = this.doc.createXULElement("box") as XUL.Box;
    shell.id = SIDEBAR_ID;
    shell.setAttribute("orient", "vertical");
    shell.setAttribute("width", String(this.getInitialShellWidth()));
    return shell;
  }

  private createSidebarContent(): HTMLElement {
    const aside = this.html("aside", "zcp-sidebar");
    aside.setAttribute("role", "complementary");
    aside.setAttribute("aria-label", getString("sidebar-title"));
    const splitter = this.createSplitter();

    const header = this.html("header", "zcp-sidebar-header");
    const identity = this.html("div", "zcp-sidebar-identity");
    const icon = this.html("span", "zcp-sidebar-icon");
    const titleBlock = this.html("div", "zcp-sidebar-title-block");
    const title = this.html("div", "zcp-sidebar-title");
    title.textContent = getString("sidebar-title");
    const selectedTitle = this.html("div", "zcp-sidebar-selected-title");
    titleBlock.append(title, selectedTitle);
    identity.append(icon, titleBlock);

    const actions = this.html("div", "zcp-sidebar-actions");
    const historyButton = this.html(
      "button",
      "zcp-icon-button zcp-history-button",
    ) as HTMLButtonElement;
    historyButton.setAttribute("type", "button");
    historyButton.setAttribute("aria-label", getString("sidebar-history"));
    historyButton.setAttribute("aria-haspopup", "true");
    historyButton.setAttribute("aria-expanded", "false");
    historyButton.title = getString("sidebar-history");
    historyButton.appendChild(this.html("span", "zcp-history-icon"));
    historyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.toggleSessionPopover();
    });

    const newSessionButton = this.html(
      "button",
      "zcp-icon-button zcp-new-session-button",
    ) as HTMLButtonElement;
    newSessionButton.setAttribute("type", "button");
    newSessionButton.setAttribute("aria-label", getString("sidebar-new-chat"));
    newSessionButton.title = getString("sidebar-new-chat");
    const newSessionIcon = this.html("span", "zcp-action-icon zcp-plus-icon");
    newSessionButton.appendChild(newSessionIcon);
    newSessionButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.createNewSession();
    });

    const closeButton = this.html("button", "zcp-icon-button");
    closeButton.setAttribute("type", "button");
    closeButton.setAttribute("aria-label", getString("sidebar-close"));
    closeButton.title = getString("sidebar-close");
    const closeIcon = this.html("span", "zcp-action-icon zcp-close-icon");
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener("click", () => this.setOpen(false));
    actions.append(historyButton, newSessionButton, closeButton);
    header.append(identity, actions);

    const sessionPopover = this.html("div", "zcp-session-popover");
    sessionPopover.setAttribute("hidden", "");
    sessionPopover.addEventListener("click", (event) =>
      event.stopPropagation(),
    );

    const chatLog = this.html("main", "zcp-chat-log");
    chatLog.setAttribute("role", "log");
    chatLog.setAttribute("aria-live", "polite");
    chatLog.appendChild(
      this.createAssistantMessage(getString("sidebar-welcome-message")),
    );

    const composer = this.createComposer();

    aside.append(splitter, header, sessionPopover, chatLog, composer);
    this.splitter = splitter;
    this.selectedTitle = selectedTitle;
    this.historyButton = historyButton;
    this.newSessionButton = newSessionButton;
    this.sessionPopover = sessionPopover;
    this.chatLog = chatLog;
    this.composer = composer;
    this.updateSessionControls();
    return aside;
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
    splitter.setPointerCapture?.(event.pointerId);

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
      splitter.releasePointerCapture?.(event.pointerId);
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
    this.resizeInput();
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

  private createComposer(): HTMLFormElement {
    const form = this.html("form", "zcp-composer") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitPrompt();
    });

    const contextRow = this.html("div", "zcp-context-row");
    const addButton = this.html("button", "zcp-context-add");
    addButton.setAttribute("type", "button");
    addButton.setAttribute("aria-label", getString("sidebar-add-context"));
    addButton.title = getString("sidebar-add-context");
    addButton.textContent = "+";
    const chip = this.html("span", "zcp-context-chip");
    const chipIcon = this.html("span", "zcp-context-chip-icon");
    const chipText = this.html("span", "zcp-context-chip-text");
    chip.append(chipIcon, chipText);
    contextRow.append(addButton, chip);

    const textarea = this.html(
      "textarea",
      "zcp-composer-input",
    ) as HTMLTextAreaElement;
    textarea.setAttribute("rows", "1");
    textarea.setAttribute(
      "placeholder",
      getString("sidebar-input-placeholder"),
    );
    textarea.addEventListener("input", () => this.resizeInput());
    textarea.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.submitPrompt();
      }
    });

    const footer = this.html("div", "zcp-composer-footer");
    const meta = this.html("div", "zcp-composer-meta");
    meta.append(
      this.createComposerPill(getString("sidebar-model-name")),
      this.createComposerPill(getString("sidebar-reasoning-depth")),
    );
    const sendButton = this.html(
      "button",
      "zcp-send-button",
    ) as HTMLButtonElement;
    sendButton.setAttribute("type", "submit");
    sendButton.setAttribute("aria-label", getString("sidebar-send"));
    sendButton.title = getString("sidebar-send");
    sendButton.textContent = "↑";
    footer.append(meta, sendButton);

    form.append(contextRow, textarea, footer);
    this.contextChipText = chipText;
    this.textarea = textarea;
    this.sendButton = sendButton;
    this.updateComposerDisabledState();
    return form;
  }

  private async toggleSessionPopover(): Promise<void> {
    if (
      !this.sessionPopover ||
      !this.activePaper ||
      this.busy ||
      !this.composerEnabled
    ) {
      return;
    }
    if (!this.sessionPopover.hasAttribute("hidden")) {
      this.hideSessionPopover();
      return;
    }
    await this.showSessionPopover();
  }

  private async showSessionPopover(): Promise<void> {
    if (!this.sessionPopover || !this.activePaper) {
      return;
    }
    const paperKey = this.activePaper.paperKey;
    const conversations =
      await getConversationStore().listPaperConversations(paperKey);
    if (
      this.destroyed ||
      !this.open ||
      !this.sessionPopover ||
      this.activePaper?.paperKey !== paperKey
    ) {
      return;
    }
    this.renderSessionPopover(conversations);
  }

  private hideSessionPopover(): void {
    this.sessionPopover?.setAttribute("hidden", "");
    this.historyButton?.setAttribute("aria-expanded", "false");
  }

  private renderSessionPopover(conversations: Conversation[]): void {
    const popover = this.sessionPopover;
    if (!popover) {
      return;
    }

    popover.replaceChildren();
    const header = this.html("div", "zcp-session-popover-header");
    header.textContent = getString("sidebar-history");
    popover.appendChild(header);

    if (!conversations.length) {
      const empty = this.html("div", "zcp-session-empty");
      empty.textContent = getString("sidebar-no-sessions");
      popover.appendChild(empty);
    } else {
      const list = this.html("div", "zcp-session-list");
      for (const conversation of conversations) {
        list.appendChild(this.createSessionRow(conversation));
      }
      popover.appendChild(list);
    }

    popover.removeAttribute("hidden");
    this.historyButton?.setAttribute("aria-expanded", "true");
  }

  private createSessionRow(conversation: Conversation): HTMLElement {
    const row = this.html("div", "zcp-session-row");
    row.toggleAttribute(
      "data-active",
      this.activeConversation?.metadata.id === conversation.metadata.id,
    );

    const content = this.html("button", "zcp-session-select");
    content.setAttribute("type", "button");
    content.addEventListener("click", () => {
      void this.switchSession(conversation);
    });

    const label = this.html("span", "zcp-session-label");
    label.textContent = getSessionTitle(conversation);
    label.title = label.textContent;
    const meta = this.html("span", "zcp-session-meta");
    meta.textContent = formatSessionMeta(conversation);
    content.append(label, meta);

    const archive = this.html("button", "zcp-session-archive");
    archive.setAttribute("type", "button");
    archive.setAttribute("aria-label", getString("sidebar-delete-session"));
    archive.title = getString("sidebar-delete-session");
    const archiveIcon = this.html("span", "zcp-action-icon zcp-close-icon");
    archive.appendChild(archiveIcon);
    archive.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.archiveSession(conversation);
    });

    row.append(content, archive);
    return row;
  }

  private async createNewSession(): Promise<void> {
    if (!this.activePaper || this.busy) {
      return;
    }
    const conversation = await getConversationStore().createPaperConversation(
      this.activePaper,
    );
    this.activeConversation = conversation;
    this.hideSessionPopover();
    this.refreshContext();
    this.renderConversation(conversation);
    this.textarea?.focus();
  }

  private async switchSession(conversation: Conversation): Promise<void> {
    if (!this.activePaper || this.busy) {
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
    this.textarea?.focus();
  }

  private async archiveSession(conversation: Conversation): Promise<void> {
    if (!this.activePaper || this.busy) {
      return;
    }
    const paper = this.activePaper;
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

  private createComposerPill(text: string): HTMLElement {
    const pill = this.html("span", "zcp-composer-pill");
    pill.textContent = text;
    return pill;
  }

  private submitPrompt(): void {
    void this.submitPromptAsync();
  }

  private async submitPromptAsync(): Promise<void> {
    const value = this.textarea?.value.trim();
    if (!value || !this.chatLog || !this.textarea || this.busy) {
      return;
    }

    let conversation =
      this.activeConversation || (await this.reloadConversationForSubmit());
    if (!conversation) {
      this.renderUnavailable();
      return;
    }

    conversation = await getConversationStore().addMessage(
      conversation.metadata,
      {
        role: "user",
        text: value,
      },
    );
    this.activeConversation = conversation;
    this.renderConversation(conversation);

    const assistantBody = this.appendAssistantMessage(
      getString("sidebar-codex-starting"),
    );
    this.textarea.value = "";
    this.resizeInput();
    this.refreshContext();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;

    this.setBusy(true);
    try {
      let hasAssistantText = false;
      const bridge = getCodexBridge();
      const prompt = buildPaperQuestionPrompt(value);
      let assistantOutput = "";
      let pendingToolBoundary = false;
      this.storePromptDebugSnapshot(prompt);
      const result = await bridge.sendPrompt(prompt, {
        conversation: conversation.metadata,
        onDelta: (delta, fullText) => {
          hasAssistantText = Boolean(fullText);
          if (pendingToolBoundary && assistantOutput.trim() && delta.trim()) {
            assistantOutput += CODEX_TOOL_OUTPUT_SEPARATOR;
            pendingToolBoundary = false;
          }
          assistantOutput += delta;
          this.renderAssistantBody(
            assistantBody,
            assistantOutput || getString("sidebar-codex-starting"),
          );
          this.scrollToBottom();
        },
        onToolActivity: () => {
          if (assistantOutput.trim()) {
            pendingToolBoundary = true;
          }
        },
        onNotice: (notice) => {
          if (!hasAssistantText) {
            this.renderAssistantBody(assistantBody, notice);
          }
          this.scrollToBottom();
        },
      });
      this.renderAssistantBody(
        assistantBody,
        assistantOutput ||
          result.text ||
          getString("sidebar-codex-empty-response"),
      );
      const metadata = await getConversationStore().updateCodexThreadId(
        conversation.metadata,
        result.threadId,
      );
      conversation = await getConversationStore().addMessage(metadata, {
        role: "assistant",
        text:
          assistantOutput ||
          result.text ||
          getString("sidebar-codex-empty-response"),
        codexThreadId: result.threadId,
        codexTurnId: result.turnId,
      });
      this.activeConversation = conversation;
      this.renderConversation(conversation);
    } catch (error) {
      const errorText = formatCodexError(error);
      this.renderAssistantBody(assistantBody, errorText);
      conversation = await getConversationStore().addMessage(
        conversation.metadata,
        {
          role: "assistant",
          text: errorText,
          status: "error",
        },
      );
      this.activeConversation = conversation;
      this.renderConversation(conversation);
    } finally {
      this.setBusy(false);
      this.scrollToBottom();
    }
  }

  private async reloadConversationForSubmit(): Promise<Conversation | null> {
    await this.loadActiveConversation(this.activeReader);
    return this.activeConversation || null;
  }

  private createUserMessage(text: string): HTMLElement {
    const row = this.html("article", "zcp-message zcp-message-user");
    const bubble = this.html("div", "zcp-message-bubble");
    bubble.textContent = text;
    row.appendChild(bubble);
    return row;
  }

  private renderConversation(conversation: Conversation): void {
    if (!this.chatLog) {
      return;
    }
    this.chatLog.replaceChildren();
    if (!conversation.messages.length) {
      this.chatLog.appendChild(
        this.createAssistantMessage(getString("sidebar-welcome-message")),
      );
    } else {
      for (const message of conversation.messages) {
        this.chatLog.appendChild(
          message.role === "user"
            ? this.createUserMessage(message.text)
            : this.createAssistantMessage(message.text),
        );
      }
    }
    this.setComposerEnabled(true);
    this.scrollToBottom();
  }

  private renderUnavailable(): void {
    this.renderStatusMessage(getString("sidebar-unavailable-message"));
    this.setComposerEnabled(false);
  }

  private renderStatusMessage(markdown: string): void {
    if (!this.chatLog) {
      return;
    }
    this.chatLog.replaceChildren(this.createAssistantMessage(markdown));
  }

  private createAssistantMessage(markdown: string): HTMLElement {
    return this.createAssistantMessageParts(markdown).row;
  }

  private appendAssistantMessage(markdown: string): HTMLElement {
    const { row, body } = this.createAssistantMessageParts(markdown);
    this.chatLog?.appendChild(row);
    return body;
  }

  private createAssistantMessageParts(markdown: string): {
    row: HTMLElement;
    body: HTMLElement;
  } {
    const row = this.html("article", "zcp-message zcp-message-assistant");
    const avatar = this.html("div", "zcp-message-avatar");
    const body = this.html("div", "zcp-message-body");
    renderMarkdown(this.doc, body, markdown);
    row.append(avatar, body);
    return { row, body };
  }

  private renderAssistantBody(body: HTMLElement, markdown: string): void {
    renderMarkdown(this.doc, body, markdown);
  }

  private storePromptDebugSnapshot(prompt: string): void {
    const debugWin = this.win as PromptDebugWindow;
    debugWin.__zcpLastPrompt = prompt;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.composer?.toggleAttribute("aria-busy", busy);
    this.updateComposerDisabledState();
    this.updateSessionControls();
    if (this.sendButton) {
      this.sendButton.textContent = busy ? "..." : "↑";
    }
  }

  private setComposerEnabled(enabled: boolean): void {
    this.composerEnabled = enabled;
    this.updateComposerDisabledState();
  }

  private updateComposerDisabledState(): void {
    const disabled = this.busy || !this.composerEnabled;
    this.textarea?.toggleAttribute("disabled", disabled);
    this.sendButton?.toggleAttribute("disabled", disabled);
  }

  private updateSessionControls(): void {
    const disabled = this.busy || !this.activePaper;
    if (this.historyButton) {
      this.historyButton.disabled = disabled;
    }
    if (this.newSessionButton) {
      this.newSessionButton.disabled = disabled;
    }
    if (disabled) {
      this.hideSessionPopover();
    }
  }

  private scrollToBottom(): void {
    if (!this.chatLog) {
      return;
    }
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private resizeInput(): void {
    if (!this.textarea) {
      return;
    }
    const hostHeight = this.shell?.clientHeight || 680;
    const maxHeight = Math.max(140, Math.floor(hostHeight * 0.42));
    this.textarea.style.height = "auto";
    this.textarea.style.maxHeight = `${maxHeight}px`;
    this.textarea.style.height = `${Math.min(
      this.textarea.scrollHeight,
      maxHeight,
    )}px`;
    this.textarea.style.overflowY =
      this.textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  private toggle(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.open) {
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
      this.detachPanel();
    }
    this.updateToggleButtons();
    this.refreshContext();
    this.notifyLayoutChanged();

    if (open) {
      if (!wasOpen) {
        this.prewarmCodexBridge();
      }
      this.win.requestAnimationFrame(() => {
        this.resizeInput();
        this.textarea?.focus();
      });
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

  private updateToggleButtons(): void {
    for (const button of [
      this.toolbarToggleButton,
      ...this.readerToolbarButtons,
    ]) {
      button?.setAttribute("checked", String(this.open));
      button?.setAttribute("aria-pressed", String(this.open));
      if (button) {
        this.updateReaderToolbarButton(button);
      }
    }
  }

  private updateReaderToolbarButton(button: Element): void {
    if (!button.classList.contains("zcp-reader-toolbar-button")) {
      return;
    }
    button.toggleAttribute("data-active", this.open);
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
      const target = event.target as Node | null;
      if (!target) {
        this.hideSessionPopover();
        return;
      }
      if (
        this.sessionPopover?.contains(target) ||
        this.historyButton?.contains(target)
      ) {
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
