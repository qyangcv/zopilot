import { getString } from "../../utils/locale";
import { config } from "../../../package.json";
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
import { getPlaceholderAnswer } from "./placeholder";
import { createReaderToolbarButton } from "./readerToolbar";
import { getSelectedItemTitle } from "./selectedItem";

const controllers = new WeakMap<Window, SidebarController>();

export { registerSidebar, unregisterSidebar, unregisterAllSidebars };

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
  private splitter?: XUL.Splitter;
  private shell?: XUL.Box;
  private selectedTitle?: HTMLElement;
  private contextChipText?: HTMLElement;
  private chatLog?: HTMLElement;
  private composer?: HTMLFormElement;
  private textarea?: HTMLTextAreaElement;
  private activeReader?: _ZoteroTypes.ReaderInstance;
  private open = false;
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
    this.registerReaderToolbarButton();
    this.ensureMountedSurfaces();
    this.bindContextRefresh();
    this.bindLayoutRefresh();
    this.refreshContext();
  }

  destroy(): void {
    this.listeners.splice(0).forEach((dispose) => dispose());
    this.styleNode?.remove();
    this.toolbarToggleButton?.remove();
    this.readerToolbarButtons.forEach((button) => button.remove());
    this.readerToolbarButtons.clear();
    this.splitter?.remove();
    this.shell?.remove();
  }

  refreshContext(
    reader?: _ZoteroTypes.ReaderInstance,
    item?: Zotero.Item,
  ): void {
    const title = this.getSelectedItemTitle(reader || this.activeReader, item);
    if (this.selectedTitle) {
      this.selectedTitle.textContent = title;
      this.selectedTitle.title = title;
    }
    if (this.contextChipText) {
      this.contextChipText.textContent = title;
      this.contextChipText.title = title;
    }
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

  private registerReaderToolbarButton(): void {
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      this.readerToolbarHandler,
      config.addonID,
    );
    this.listeners.push(() => {
      Zotero.Reader.unregisterEventListener(
        "renderToolbar",
        this.readerToolbarHandler,
      );
    });
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
    if (event.doc.getElementById(READER_TOOLBAR_BUTTON_ID)) {
      return;
    }

    const button = createReaderToolbarButton(event.doc, this.open, () =>
      this.toggle(event.reader),
    );

    this.readerToolbarButtons.add(button);
    event.doc.defaultView?.addEventListener(
      "unload",
      () => this.readerToolbarButtons.delete(button),
      { once: true },
    );
    this.updateReaderToolbarButton(button);
    event.append(button);
  }

  private openCopilotPane(reader?: _ZoteroTypes.ReaderInstance): void {
    this.activeReader = reader;
    this.ensureMountedSurfaces();
    this.setOpen(true);
    this.refreshContext(reader);
  }

  private mountPanel(): void {
    if (this.shell?.isConnected && this.splitter?.isConnected) {
      return;
    }

    const host = this.getSidebarHost();
    if (!host || this.doc.getElementById(SIDEBAR_ID)) {
      return;
    }

    this.splitter = this.createSplitter();
    this.shell = this.createShell();
    this.shell.appendChild(this.createSidebarContent());
    host.append(this.splitter, this.shell);
    this.setOpen(false);
  }

  private getSidebarHost(): Element | null {
    return this.doc.getElementById("tabs-deck")?.parentElement || null;
  }

  private createSplitter(): XUL.Splitter {
    const splitter = this.doc.createXULElement("splitter") as XUL.Splitter;
    splitter.id = SPLITTER_ID;
    splitter.setAttribute("resizebefore", "closest");
    splitter.setAttribute("resizeafter", "closest");
    splitter.setAttribute("collapse", "after");
    splitter.setAttribute("orient", "horizontal");
    const grippy = this.doc.createXULElement("grippy");
    splitter.appendChild(grippy);
    return splitter;
  }

  private createShell(): XUL.Box {
    const shell = this.doc.createXULElement("box") as XUL.Box;
    shell.id = SIDEBAR_ID;
    shell.setAttribute("orient", "vertical");
    shell.setAttribute("width", "372");
    shell.setAttribute("zotero-persist", "width");
    return shell;
  }

  private createSidebarContent(): HTMLElement {
    const aside = this.html("aside", "zcp-sidebar");
    aside.setAttribute("role", "complementary");
    aside.setAttribute("aria-label", getString("sidebar-title"));

    const header = this.html("header", "zcp-sidebar-header");
    const identity = this.html("div", "zcp-sidebar-identity");
    const icon = this.html("span", "zcp-sidebar-icon");
    const titleBlock = this.html("div", "zcp-sidebar-title-block");
    const title = this.html("div", "zcp-sidebar-title");
    title.textContent = getString("sidebar-title");
    const selectedTitle = this.html("div", "zcp-sidebar-selected-title");
    titleBlock.append(title, selectedTitle);
    identity.append(icon, titleBlock);

    const closeButton = this.html("button", "zcp-icon-button");
    closeButton.setAttribute("type", "button");
    closeButton.setAttribute("aria-label", getString("sidebar-close"));
    closeButton.title = getString("sidebar-close");
    closeButton.textContent = "x";
    closeButton.addEventListener("click", () => this.setOpen(false));
    header.append(identity, closeButton);

    const chatLog = this.html("main", "zcp-chat-log");
    chatLog.setAttribute("role", "log");
    chatLog.setAttribute("aria-live", "polite");
    chatLog.appendChild(
      this.createAssistantMessage(getString("sidebar-welcome-message")),
    );

    const composer = this.createComposer();

    aside.append(header, chatLog, composer);
    this.selectedTitle = selectedTitle;
    this.chatLog = chatLog;
    this.composer = composer;
    return aside;
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
    const sendButton = this.html("button", "zcp-send-button");
    sendButton.setAttribute("type", "submit");
    sendButton.setAttribute("aria-label", getString("sidebar-send"));
    sendButton.title = getString("sidebar-send");
    sendButton.textContent = "↑";
    footer.append(meta, sendButton);

    form.append(contextRow, textarea, footer);
    this.contextChipText = chipText;
    this.textarea = textarea;
    return form;
  }

  private createComposerPill(text: string): HTMLElement {
    const pill = this.html("span", "zcp-composer-pill");
    pill.textContent = text;
    return pill;
  }

  private submitPrompt(): void {
    const value = this.textarea?.value.trim();
    if (!value || !this.chatLog || !this.textarea) {
      return;
    }

    this.chatLog.appendChild(this.createUserMessage(value));
    this.chatLog.appendChild(
      this.createAssistantMessage(getPlaceholderAnswer()),
    );
    this.textarea.value = "";
    this.resizeInput();
    this.refreshContext();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  private createUserMessage(text: string): HTMLElement {
    const row = this.html("article", "zcp-message zcp-message-user");
    const bubble = this.html("div", "zcp-message-bubble");
    bubble.textContent = text;
    row.appendChild(bubble);
    return row;
  }

  private createAssistantMessage(markdown: string): HTMLElement {
    const row = this.html("article", "zcp-message zcp-message-assistant");
    const avatar = this.html("div", "zcp-message-avatar");
    const body = this.html("div", "zcp-message-body");
    renderMarkdown(this.doc, body, markdown);
    row.append(avatar, body);
    return row;
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
    this.open = open;
    if (!open) {
      this.activeReader = undefined;
    }
    setHidden(this.shell, !open);
    setHidden(this.splitter, !open);
    this.updateToggleButtons();
    this.refreshContext();

    if (open) {
      this.win.requestAnimationFrame(() => {
        this.resizeInput();
        this.textarea?.focus();
      });
    }
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
        this.refreshContext();
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
    const refreshSoon = () => {
      this.win.setTimeout(() => {
        this.ensureMountedSurfaces();
        this.refreshContext();
      }, 0);
    };

    const observer = new this.win.MutationObserver(refreshSoon);
    observer.observe(this.doc.documentElement, {
      childList: true,
      subtree: true,
    });
    this.listeners.push(() => observer.disconnect());

    this.win.addEventListener("focus", refreshSoon);
    this.win.addEventListener("resize", refreshSoon);
    this.listeners.push(() => {
      this.win.removeEventListener("focus", refreshSoon);
      this.win.removeEventListener("resize", refreshSoon);
    });

    const tabContainer = this.doc.getElementById("tabbrowser-tabs");
    tabContainer?.addEventListener("TabSelect", refreshSoon);
    if (tabContainer) {
      this.listeners.push(() => {
        tabContainer.removeEventListener("TabSelect", refreshSoon);
      });
    }
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

function setHidden(element: Element | undefined, hidden: boolean): void {
  if (!element) {
    return;
  }
  if (hidden) {
    element.setAttribute("hidden", "true");
  } else {
    element.removeAttribute("hidden");
  }
}
