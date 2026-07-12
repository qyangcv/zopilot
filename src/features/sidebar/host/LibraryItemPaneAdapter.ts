import { getString } from "../../../app/localization";
import { createStaticIconElement } from "../ui/staticIcons";
import {
  probeLibraryItemPane,
  type LibraryItemPaneProbeResult,
  type LibraryItemPaneProbeSuccess,
  type LibraryItemPaneUnavailableResult,
} from "./libraryItemPaneProbe";

const LIBRARY_PANEL_ID = "zopilot-library-item-pane-deck";
const LIBRARY_PANE_NAME = "zopilot-library";
type LibraryItemPaneAdapterOptions = {
  onActivate?: () => void;
  onDeactivate?: () => void;
};

class LibraryItemPaneAdapter {
  private active = false;
  private panel?: HTMLElement;
  private button?: HTMLButtonElement;
  private previousPanel?: Element;
  private observer?: MutationObserver;
  private itemPaneObserver?: MutationObserver;
  private observedItemPane?: Element;
  private listeningDeck?: Element;
  private listeningSidenav?: Element;
  private unavailable?: LibraryItemPaneUnavailableResult;

  private readonly onButtonClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate?.();
  };

  private readonly onButtonKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate?.();
  };

  private readonly onNativeButtonClick = (event: Event) => {
    if (!this.active) return;
    const mouseEvent = event as MouseEvent;
    if (typeof mouseEvent.button === "number" && mouseEvent.button !== 0)
      return;
    const target =
      event.target instanceof this.win.Element
        ? (event.target as Element)
        : undefined;
    if (!target) return;
    const button = target.closest(".btn[data-pane]");
    if (!button || !this.listeningSidenav?.contains(button)) return;
    this.selectNative();
    this.options.onDeactivate?.();
  };

  private readonly onDeckSelect = () => {
    if (!this.active) return;
    const probe = probeLibraryItemPane(this.win.document);
    if (!probe.available || !this.panel) return;
    const selected = getSelectedPanel(probe);
    if (selected && selected !== this.panel) this.previousPanel = selected;
    if (selected !== this.panel) {
      this.win.setTimeout(() => {
        if (this.active && this.panel) selectPanel(probe, this.panel);
      }, 0);
    }
  };

  constructor(
    private readonly win: Window,
    private readonly options: LibraryItemPaneAdapterOptions = {},
  ) {}

  mount(): LibraryItemPaneProbeResult {
    const probe = probeLibraryItemPane(this.win.document);
    if (!probe.available) {
      this.unavailable = probe;
      return probe;
    }
    this.reconcile(probe);
    if (!this.observer) {
      const observer = new this.win.MutationObserver(() => {
        const latest = probeLibraryItemPane(this.win.document);
        if (latest.available) {
          this.reconcile(latest);
          this.ensureActiveSelection();
        }
      });
      observer.observe(this.win.document.documentElement, {
        childList: true,
        subtree: true,
      });
      this.observer = observer;
    }
    this.unavailable = undefined;
    return probe;
  }

  getUnavailableResult(): LibraryItemPaneUnavailableResult | undefined {
    return this.unavailable;
  }

  getPanel(): HTMLElement | undefined {
    return this.panel;
  }

  ensurePanel(): HTMLElement | undefined {
    const probe = this.mount();
    if (!probe.available) return undefined;
    const existing = this.win.document.getElementById(LIBRARY_PANEL_ID);
    if (existing) {
      if (existing.parentElement !== probe.deck) {
        existing.remove();
        this.panel = undefined;
      } else {
        this.panel = existing as HTMLElement;
        return this.panel;
      }
    }
    const panel = createPanel(this.win.document);
    probe.deck.append(panel);
    this.panel = panel;
    return panel;
  }

  selectZopilot(): boolean {
    const probe = this.mount();
    if (!probe.available) return false;
    const panel = this.ensurePanel();
    if (!panel) return false;
    const selected = getSelectedPanel(probe);
    if (selected && selected !== panel) this.previousPanel = selected;
    probe.itemPane.collapsed = false;
    probe.itemPane.setAttribute("collapsed", "false");
    selectPanel(probe, panel);
    this.setActive(true);
    return true;
  }

  selectNative(): boolean {
    const probe = this.mount();
    if (!probe.available) return false;
    this.setActive(false);
    probe.itemPane.render?.();
    const selected = getSelectedPanel(probe);
    if (selected && selected !== this.panel) this.previousPanel = selected;
    const panel =
      this.previousPanel && this.previousPanel.parentElement === probe.deck
        ? this.previousPanel
        : probe.deck.firstElementChild;
    if (panel) selectPanel(probe, panel);
    return Boolean(panel);
  }

  ensureActiveSelection(): void {
    if (!this.active) return;
    const probe = probeLibraryItemPane(this.win.document);
    if (!probe.available || !this.panel) return;
    const selected = getSelectedPanel(probe);
    if (selected && selected !== this.panel) this.previousPanel = selected;
    if (selected !== this.panel) selectPanel(probe, this.panel);
  }

  deactivate(): void {
    this.setActive(false);
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.itemPaneObserver?.disconnect();
    this.itemPaneObserver = undefined;
    this.observedItemPane = undefined;
    this.detachDeckListener();
    this.detachSidenavListener();
    this.button?.removeEventListener("click", this.onButtonClick);
    this.button?.removeEventListener("keydown", this.onButtonKeyDown);
    this.button?.remove();
    this.button = undefined;
    this.panel?.remove();
    this.panel = undefined;
  }

  private reconcile(probe: LibraryItemPaneProbeSuccess): void {
    this.attachDeckListener(probe.deck);
    this.attachSidenavListener(probe.sidenav);
    this.observeItemPane(probe.itemPane);
    const duplicates = probe.sidenav.querySelectorAll(
      `.zp-library-sidenav-button[data-pane="${LIBRARY_PANE_NAME}"]`,
    );
    (Array.from(duplicates) as Element[]).forEach((element) => {
      if (element !== this.button) element.remove();
    });
    if (!this.button || !this.button.isConnected) {
      this.button = this.createButton();
    }
    if (this.button.parentElement !== probe.sidenav) {
      probe.sidenav.append(this.button);
    }
    this.syncButton();
  }

  private observeItemPane(itemPane: Element): void {
    if (this.observedItemPane === itemPane) return;
    this.itemPaneObserver?.disconnect();
    const observer = new this.win.MutationObserver(() => {
      if (!this.active) return;
      this.win.setTimeout(() => this.ensureActiveSelection(), 0);
    });
    observer.observe(itemPane, {
      attributes: true,
      attributeFilter: ["view-type"],
    });
    this.itemPaneObserver = observer;
    this.observedItemPane = itemPane;
  }

  private attachDeckListener(deck: Element): void {
    if (this.listeningDeck === deck) return;
    this.detachDeckListener();
    deck.addEventListener("select", this.onDeckSelect);
    this.listeningDeck = deck;
  }

  private detachDeckListener(): void {
    this.listeningDeck?.removeEventListener("select", this.onDeckSelect);
    this.listeningDeck = undefined;
  }

  private attachSidenavListener(sidenav: Element): void {
    if (this.listeningSidenav === sidenav) return;
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
    button.className = "zp-context-sidenav-button zp-library-sidenav-button";
    button.type = "button";
    button.dataset.pane = LIBRARY_PANE_NAME;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", LIBRARY_PANEL_ID);
    button.setAttribute("aria-label", getString("sidebar-title"));
    button.title = getString("sidebar-title");
    button.appendChild(
      createStaticIconElement(doc, "brand", {
        className: "zp-context-sidenav-icon",
        size: 20,
      }),
    );
    button.addEventListener("click", this.onButtonClick);
    button.addEventListener("keydown", this.onButtonKeyDown);
    return button;
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      this.syncButton();
      return;
    }
    this.active = active;
    this.syncButton();
  }

  private syncButton(): void {
    if (!this.button) return;
    this.button.toggleAttribute("selected", this.active);
    this.button.toggleAttribute("data-active", this.active);
    this.button.setAttribute("aria-selected", String(this.active));
    this.button.setAttribute("aria-pressed", String(this.active));
  }
}

function createPanel(doc: Document): HTMLElement {
  const createXULElement = (
    doc as Document & { createXULElement?: (tagName: string) => Element }
  ).createXULElement;
  const panel = (
    createXULElement
      ? createXULElement.call(doc, "vbox")
      : doc.createElementNS("http://www.w3.org/1999/xhtml", "section")
  ) as HTMLElement | XUL.Box;
  panel.id = LIBRARY_PANEL_ID;
  panel.className = "zp-context-pane-deck";
  panel.setAttribute("data-pane", LIBRARY_PANE_NAME);
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

function getSelectedPanel(probe: LibraryItemPaneProbeSuccess): Element | null {
  if (probe.selectionMode === "selectedPanel") {
    return (probe.deck.selectedPanel as Element | null | undefined) || null;
  }
  const index = Number(probe.deck.selectedIndex || 0);
  return probe.deck.children.item(index);
}

function selectPanel(probe: LibraryItemPaneProbeSuccess, panel: Element): void {
  if (probe.selectionMode === "selectedPanel") {
    probe.deck.selectedPanel = panel as XUL.Deck["selectedPanel"];
    return;
  }
  const index = Array.prototype.indexOf.call(probe.deck.children, panel);
  if (index >= 0) probe.deck.selectedIndex = index;
}

export { LIBRARY_PANEL_ID, LibraryItemPaneAdapter };
export type { LibraryItemPaneAdapterOptions };
