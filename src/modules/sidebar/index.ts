import { getString } from "../../utils/locale";
import { config } from "../../../package.json";

const TOOLBAR_TOGGLE_BUTTON_ID = "zotero-copilot-sidebar-toolbar-toggle";
const READER_TOOLBAR_BUTTON_ID = "zotero-copilot-reader-toolbar-toggle";
const SIDEBAR_ID = "zotero-copilot-sidebar-shell";
const SPLITTER_ID = "zotero-copilot-sidebar-splitter";
const STYLE_URI = `chrome://${config.addonRef}/content/zoteroPane.css`;
const ICON_URI = `chrome://${config.addonRef}/content/icons/message-circle.svg`;

const HTML_NS = "http://www.w3.org/1999/xhtml";

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

    ensureReaderToolbarStyles(event.doc);

    const button = event.doc.createElement("button");
    button.id = READER_TOOLBAR_BUTTON_ID;
    button.className = "zcp-reader-toolbar-button";
    button.type = "button";
    button.title = getString("sidebar-toggle-tooltip");
    button.setAttribute("aria-label", getString("sidebar-toggle-tooltip"));
    button.setAttribute("aria-pressed", String(this.open));

    const icon = event.doc.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    button.addEventListener("click", () => this.openCopilotPane(event.reader));

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

  private toggle(): void {
    if (this.open) {
      this.setOpen(false);
    } else {
      this.openCopilotPane();
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
    if (currentItem) {
      return (
        currentItem.getDisplayTitle?.() ||
        currentItem.getField?.("title") ||
        getString("sidebar-untitled-item")
      );
    }

    if (reader?.itemID) {
      const item = Zotero.Items.get(reader.itemID);
      return (
        item?.parentItem?.getDisplayTitle?.() ||
        item?.parentItem?.getField?.("title") ||
        item?.getDisplayTitle?.() ||
        item?.getField?.("title") ||
        getString("sidebar-untitled-item")
      );
    }

    const pane =
      (this.win as any).ZoteroPane || (this.win as any).ZoteroPane_Local;
    const selectedItems =
      pane?.getSelectedItems?.() || pane?.itemsView?.getSelectedItems?.() || [];

    if (!selectedItems.length) {
      return getString("sidebar-no-item-selected");
    }
    if (selectedItems.length > 1) {
      return getString("sidebar-multiple-items-selected", {
        args: { count: selectedItems.length },
      });
    }

    const item = selectedItems[0];
    return (
      item?.getDisplayTitle?.() ||
      item?.getField?.("title") ||
      item?.title ||
      getString("sidebar-untitled-item")
    );
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

function ensureReaderToolbarStyles(doc: Document): void {
  if (doc.getElementById("zotero-copilot-reader-toolbar-style")) {
    return;
  }
  const style = doc.createElement("style");
  style.id = "zotero-copilot-reader-toolbar-style";
  style.textContent = `
    .zcp-reader-toolbar-button {
      align-items: center;
      appearance: none;
      background: transparent;
      border: 0;
      border-radius: 4px;
      box-sizing: border-box;
      color: currentColor;
      cursor: default;
      display: inline-flex;
      height: 32px;
      justify-content: center;
      margin: 0 2px;
      min-width: 32px;
      padding: 0;
    }
    .zcp-reader-toolbar-button:hover,
    .zcp-reader-toolbar-button[data-active] {
      background: color-mix(in srgb, currentColor 12%, transparent);
    }
    .zcp-reader-toolbar-button span {
      background: currentColor;
      height: 20px;
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath stroke='none' d='M0 0h24v24H0z' fill='none'/%3E%3Cpath d='M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1'/%3E%3C/svg%3E");
      mask-position: center;
      mask-repeat: no-repeat;
      mask-size: contain;
      opacity: 0.72;
      width: 20px;
    }
    .zcp-reader-toolbar-button[data-active] span {
      opacity: 1;
    }
  `;
  doc.head?.appendChild(style);
}

function renderMarkdown(
  doc: Document,
  container: HTMLElement,
  markdown: string,
): void {
  container.replaceChildren();
  const lines = markdown.trim().split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      const pre = doc.createElementNS(HTML_NS, "pre");
      const code = doc.createElementNS(HTML_NS, "code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
      continue;
    }

    if (line.startsWith("$$")) {
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      const block = doc.createElementNS(HTML_NS, "div");
      block.className = "zcp-math-block";
      block.textContent = mathLines.join("\n");
      container.appendChild(block);
      continue;
    }

    if (isTableStart(lines, index)) {
      const table = doc.createElementNS(HTML_NS, "table");
      const headerCells = splitTableRow(lines[index]);
      const bodyRows: string[][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        bodyRows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const thead = doc.createElementNS(HTML_NS, "thead");
      const headerRow = doc.createElementNS(HTML_NS, "tr");
      headerCells.forEach((cell) => {
        const th = doc.createElementNS(HTML_NS, "th");
        appendInline(doc, th, cell);
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = doc.createElementNS(HTML_NS, "tbody");
      bodyRows.forEach((row) => {
        const tr = doc.createElementNS(HTML_NS, "tr");
        row.forEach((cell) => {
          const td = doc.createElementNS(HTML_NS, "td");
          appendInline(doc, td, cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      container.appendChild(table);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const list = doc.createElementNS(HTML_NS, "ul");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInline(doc, item, lines[index].replace(/^\s*[-*]\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = doc.createElementNS(HTML_NS, "ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInline(doc, item, lines[index].replace(/^\s*\d+\.\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    const paragraph = doc.createElementNS(HTML_NS, "p");
    appendInline(doc, paragraph, line);
    container.appendChild(paragraph);
    index += 1;
  }
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    /^\s*\|.+\|\s*$/.test(lines[index]) &&
    index + 1 < lines.length &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function appendInline(doc: Document, parent: Element, text: string): void {
  const tokenPattern =
    /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\$[^$]+\$|\\\([^)]+\\\))/g;
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > lastIndex) {
      parent.appendChild(
        doc.createTextNode(text.slice(lastIndex, match.index)),
      );
    }
    parent.appendChild(createInlineNode(doc, match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }
}

function createInlineNode(doc: Document, token: string): Node {
  if (token.startsWith("[")) {
    const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      const anchor = doc.createElementNS(HTML_NS, "a");
      anchor.textContent = match[1];
      anchor.setAttribute("href", match[2]);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      return anchor;
    }
  }
  if (token.startsWith("`")) {
    const code = doc.createElementNS(HTML_NS, "code");
    code.textContent = token.slice(1, -1);
    return code;
  }
  if (token.startsWith("**")) {
    const strong = doc.createElementNS(HTML_NS, "strong");
    strong.textContent = token.slice(2, -2);
    return strong;
  }
  if (token.startsWith("$")) {
    return createInlineMath(doc, token.slice(1, -1));
  }
  if (token.startsWith("\\(")) {
    return createInlineMath(doc, token.slice(2, -2));
  }
  return doc.createTextNode(token);
}

function createInlineMath(doc: Document, text: string): HTMLElement {
  const math = doc.createElementNS(HTML_NS, "span") as HTMLElement;
  math.className = "zcp-math-inline";
  math.textContent = text;
  return math;
}

function getPlaceholderAnswer(): string {
  return [
    getString("sidebar-placeholder-answer"),
    "",
    `- ${getString("sidebar-placeholder-context")}`,
    `- ${getString("sidebar-placeholder-rendering")}`,
    "",
    `| ${getString("sidebar-placeholder-surface")} | ${getString(
      "sidebar-placeholder-status",
    )} |`,
    "| --- | --- |",
    `| Markdown | ${getString("sidebar-placeholder-markdown-ready")} |`,
    `| LaTeX | ${getString("sidebar-placeholder-latex-placeholder")} |`,
    "",
    `${getString("sidebar-placeholder-inline-formula")} $E = mc^2$`,
    "",
    "$$",
    "p(y \\mid x) = \\prod_t p(y_t \\mid y_{<t}, x)",
    "$$",
    "",
    "[Zotero](https://www.zotero.org)",
  ].join("\n");
}
