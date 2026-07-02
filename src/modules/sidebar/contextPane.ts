import { getString } from "../../utils/locale";
import { createLogger } from "../../utils/logger";
import { createStaticIconElement } from "./app/staticIcons";
import { CONTEXT_PANE_DECK_ID } from "./constants";

export { ContextPaneDeckAdapter, ContextPaneSidenavAdapter, probeContextPane };
export type {
  ContextPaneActiveState,
  ContextPaneProbeResult,
  ContextPaneProbeSuccess,
  ContextPaneUnavailableResult,
};

type ContextPaneActiveState = "item" | "notes" | "zopilot";

type ContextPaneProbeSuccess = {
  available: true;
  contextPane: Element;
  inner: Element;
  deck: Element & Partial<XUL.Deck>;
  itemDeck: Element;
  notesDeck: Element;
  sidenav: Element;
  notesButton: Element;
  selectionMode: "selectedPanel" | "selectedIndex";
};

type ContextPaneUnavailableResult = {
  available: false;
  zoteroVersion?: string;
  missingSelector?: string;
  reason: string;
};

type ContextPaneProbeResult =
  | ContextPaneProbeSuccess
  | ContextPaneUnavailableResult;

type ContextPaneDeckAdapterOptions = {
  onActiveStateChange?: (state: ContextPaneActiveState) => void;
};

type ContextPaneNativeState = Exclude<ContextPaneActiveState, "zopilot">;

const logger = createLogger("sidebar.contextPane");
const ZOPILOT_PANE = "zopilot-context";

class ContextPaneDeckAdapter {
  private activeState: ContextPaneActiveState = "item";
  private panel?: Element;
  private sidenav?: ContextPaneSidenavAdapter;
  private mounted = false;
  private unavailable?: ContextPaneUnavailableResult;

  constructor(
    private readonly win: Window,
    private readonly options: ContextPaneDeckAdapterOptions = {},
  ) {}

  mount(): ContextPaneProbeResult {
    const probe = probeContextPane(this.win.document);
    if (!probe.available) {
      this.unavailable = probe;
      logger.warn("Zotero context pane unavailable", probe);
      return probe;
    }

    if (!this.sidenav) {
      this.sidenav = new ContextPaneSidenavAdapter(this.win, probe.sidenav, {
        onActivate: () => this.select("zopilot"),
        onActivateNativePane: (state) => this.select(state),
      });
    }
    this.sidenav.mount();
    this.sidenav.setActive(this.activeState === "zopilot");
    this.mounted = true;
    this.unavailable = undefined;
    return probe;
  }

  getUnavailableResult(): ContextPaneUnavailableResult | undefined {
    return this.unavailable;
  }

  getActiveState(): ContextPaneActiveState {
    return this.activeState;
  }

  getPanel(): HTMLElement | undefined {
    return this.panel instanceof this.win.HTMLElement
      ? (this.panel as HTMLElement)
      : undefined;
  }

  ensurePanel(): HTMLElement | undefined {
    const probe = this.mount();
    if (!probe.available) {
      return undefined;
    }

    const existing = this.win.document.getElementById(CONTEXT_PANE_DECK_ID);
    if (existing) {
      if (existing.parentElement !== probe.deck) {
        existing.remove();
        this.panel = undefined;
      } else {
        this.panel = existing;
        return existing as HTMLElement;
      }
    }

    const panel = this.createPanel();
    probe.deck.append(panel);
    this.panel = panel;
    return panel;
  }

  select(state: ContextPaneActiveState): boolean {
    const probe = this.mount();
    if (!probe.available) {
      return false;
    }

    const panel =
      state === "zopilot"
        ? this.ensurePanel()
        : state === "notes"
          ? probe.notesDeck
          : probe.itemDeck;
    if (!panel) {
      return false;
    }

    this.selectPanel(probe, panel);
    this.setActiveState(state);
    return true;
  }

  focusPanel(): void {
    this.getPanel()?.focus();
  }

  destroy(): void {
    this.mounted = false;
    this.sidenav?.destroy();
    this.sidenav = undefined;
    this.panel?.remove();
    this.panel = undefined;
  }

  private createPanel(): HTMLElement {
    const doc = this.win.document;
    const createXULElement = (
      doc as Document & {
        createXULElement?: (tagName: string) => Element;
      }
    ).createXULElement;
    const panel = (
      createXULElement
        ? createXULElement.call(doc, "vbox")
        : doc.createElementNS("http://www.w3.org/1999/xhtml", "section")
    ) as HTMLElement | XUL.Box;
    panel.id = CONTEXT_PANE_DECK_ID;
    panel.className = "zp-context-pane-deck";
    panel.setAttribute("data-pane", ZOPILOT_PANE);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("tabindex", "-1");
    panel.setAttribute("flex", "1");
    panel.setAttribute("aria-label", getString("sidebar-title"));
    (panel as HTMLElement).style.flex = "1 1 auto";
    (panel as HTMLElement).style.minHeight = "0";
    (panel as HTMLElement).style.height = "100%";
    (panel as HTMLElement).style.overflow = "hidden";
    return panel as HTMLElement;
  }

  private selectPanel(probe: ContextPaneProbeSuccess, panel: Element): void {
    if (probe.selectionMode === "selectedPanel") {
      probe.deck.selectedPanel = panel as XUL.Deck["selectedPanel"];
      return;
    }
    const index = Array.prototype.indexOf.call(probe.deck.children, panel);
    if (index >= 0) {
      probe.deck.selectedIndex = index;
    }
  }

  private setActiveState(state: ContextPaneActiveState): void {
    if (this.activeState === state && this.mounted) {
      this.sidenav?.setActive(state === "zopilot");
      return;
    }
    this.activeState = state;
    this.sidenav?.setActive(state === "zopilot");
    this.options.onActiveStateChange?.(state);
  }
}

class ContextPaneSidenavAdapter {
  private active = false;
  private button?: HTMLButtonElement;
  private observer?: MutationObserver;
  private listeningSidenav?: Element;
  private readonly onClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate();
  };
  private readonly onNativeButtonClick = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (typeof mouseEvent.button === "number" && mouseEvent.button !== 0) {
      return;
    }
    const target =
      event.target instanceof this.win.Element
        ? (event.target as Element)
        : undefined;
    if (!target) {
      return;
    }
    const button = target.closest(".btn[data-pane]");
    if (!button || !this.sidenav.contains(button)) {
      return;
    }
    const pane = button.getAttribute("data-pane");
    if (!pane || pane === ZOPILOT_PANE) {
      return;
    }
    this.options.onActivateNativePane(
      pane === "context-notes" ? "notes" : "item",
    );
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate();
  };

  constructor(
    private readonly win: Window,
    private sidenav: Element,
    private readonly options: {
      onActivate: () => void;
      onActivateNativePane: (state: ContextPaneNativeState) => void;
    },
  ) {}

  mount(): void {
    this.reconcile();
    if (this.observer) {
      return;
    }
    const root = this.win.document.documentElement;
    if (!root) {
      return;
    }
    const observer = new this.win.MutationObserver(() => this.reconcile());
    observer.observe(root, {
      childList: true,
      subtree: true,
    });
    this.observer = observer;
  }

  setActive(active: boolean): void {
    const changed = this.active !== active;
    this.active = active;
    this.syncSelectionState({ restoreNativeSelection: changed && !active });
  }

  private syncSelectionState(
    options: { restoreNativeSelection?: boolean } = {},
  ): void {
    this.syncNativeSelectionState(options);
    const button = this.button;
    if (!button) {
      return;
    }
    button.toggleAttribute("selected", this.active);
    button.toggleAttribute("data-active", this.active);
    button.setAttribute("aria-selected", String(this.active));
    button.setAttribute("aria-pressed", String(this.active));
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.detachSidenavListener();
    this.button?.removeEventListener("click", this.onClick);
    this.button?.removeEventListener("keydown", this.onKeyDown);
    this.button?.remove();
    this.button = undefined;
  }

  private reconcile(): void {
    const latest = this.win.document.getElementById(
      "zotero-context-pane-sidenav",
    );
    if (latest) {
      this.sidenav = latest;
    }
    if (!this.sidenav.isConnected) {
      this.detachSidenavListener();
      return;
    }
    this.attachSidenavListener(this.sidenav);
    (
      Array.from(
        this.sidenav.querySelectorAll(
          `.zp-context-sidenav-button[data-pane="${ZOPILOT_PANE}"]`,
        ),
      ) as Element[]
    ).forEach((existing) => {
      if (existing !== this.button) {
        existing.remove();
      }
    });
    if (!this.button || !this.button.isConnected) {
      this.button = this.createButton();
    }
    if (this.button.parentElement !== this.sidenav) {
      this.sidenav.append(this.button);
    }
    this.syncSelectionState();
  }

  private syncNativeSelectionState(options: {
    restoreNativeSelection?: boolean;
  }): void {
    if (!this.active) {
      if (options.restoreNativeSelection) {
        (
          this.sidenav as Element & {
            render?: () => void;
          }
        ).render?.();
      }
      return;
    }

    (
      Array.from(
        this.sidenav.querySelectorAll(
          ".highlight-notes-inactive, .highlight-notes-active",
        ),
      ) as Element[]
    ).forEach((group) => {
      group.classList.remove("highlight");
      if (group.getAttribute("role") === "tab") {
        group.setAttribute("aria-selected", "false");
      }
    });

    (
      Array.from(this.sidenav.querySelectorAll(".btn[data-pane]")) as Element[]
    ).forEach((button) => {
      if (button.getAttribute("data-pane") === ZOPILOT_PANE) {
        return;
      }
      button.setAttribute("aria-selected", "false");
    });
  }

  private attachSidenavListener(sidenav: Element): void {
    if (this.listeningSidenav === sidenav) {
      return;
    }
    this.detachSidenavListener();
    sidenav.addEventListener("click", this.onNativeButtonClick, true);
    this.listeningSidenav = sidenav;
  }

  private detachSidenavListener(): void {
    this.listeningSidenav?.removeEventListener(
      "click",
      this.onNativeButtonClick,
      true,
    );
    this.listeningSidenav = undefined;
  }

  private createButton(): HTMLButtonElement {
    const doc = this.win.document;
    const button = doc.createElement("button");
    button.className = "zp-context-sidenav-button";
    button.type = "button";
    button.dataset.pane = ZOPILOT_PANE;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", CONTEXT_PANE_DECK_ID);
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", getString("sidebar-title"));
    button.title = getString("sidebar-title");
    button.appendChild(
      createStaticIconElement(doc, "brand", {
        className: "zp-context-sidenav-icon",
        size: 20,
      }),
    );
    button.addEventListener("click", this.onClick);
    button.addEventListener("keydown", this.onKeyDown);
    return button;
  }
}

function probeContextPane(doc: Document): ContextPaneProbeResult {
  const contextPane = requireSelector(doc, "#zotero-context-pane");
  if (!contextPane) {
    return unavailable("#zotero-context-pane", "missing context pane");
  }
  const inner = requireSelector(doc, "#zotero-context-pane-inner");
  if (!inner) {
    return unavailable(
      "#zotero-context-pane-inner",
      "missing context pane inner",
    );
  }
  const deck = requireSelector(doc, "#zotero-context-pane-deck") as
    | (Element & Partial<XUL.Deck>)
    | undefined;
  if (!deck) {
    return unavailable("#zotero-context-pane-deck", "missing top context deck");
  }
  const itemDeck = requireSelector(doc, "#zotero-context-pane-item-deck");
  if (!itemDeck) {
    return unavailable("#zotero-context-pane-item-deck", "missing item deck");
  }
  const notesDeck = requireSelector(doc, "#zotero-context-pane-notes-deck");
  if (!notesDeck) {
    return unavailable("#zotero-context-pane-notes-deck", "missing notes deck");
  }
  if (notesDeck.parentElement !== deck) {
    return unavailable(
      "#zotero-context-pane-notes-deck",
      "notes deck is not a direct child of top context deck",
    );
  }
  const sidenav = requireSelector(doc, "#zotero-context-pane-sidenav");
  if (!sidenav) {
    return unavailable(
      "#zotero-context-pane-sidenav",
      "missing context sidenav",
    );
  }
  const notesButton =
    sidenav.querySelector('[data-pane="context-notes"]') ||
    doc.querySelector('[data-pane="context-notes"]');
  if (!notesButton) {
    return unavailable(
      '[data-pane="context-notes"]',
      "missing notes sidenav button",
    );
  }

  const selectionMode =
    "selectedPanel" in deck
      ? "selectedPanel"
      : "selectedIndex" in deck
        ? "selectedIndex"
        : undefined;
  if (!selectionMode) {
    return unavailable(
      "#zotero-context-pane-deck",
      "top context deck cannot assign a selected panel",
    );
  }

  return {
    available: true,
    contextPane,
    inner,
    deck,
    itemDeck,
    notesDeck,
    sidenav,
    notesButton,
    selectionMode,
  };
}

function requireSelector(doc: Document, selector: string): Element | undefined {
  return doc.querySelector(selector) || undefined;
}

function unavailable(
  missingSelector: string,
  reason: string,
): ContextPaneUnavailableResult {
  return {
    available: false,
    zoteroVersion: (globalThis as { Zotero?: { version?: string } }).Zotero
      ?.version,
    missingSelector,
    reason,
  };
}
