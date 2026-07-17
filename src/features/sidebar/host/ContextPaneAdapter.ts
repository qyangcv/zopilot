import { getString } from "../../../app/localization";
import { createLogger } from "../../../runtime/logging/logger";
import { CONTEXT_PANE_DECK_ID, ZOPILOT_CONTEXT_PANE } from "./constants";
import { ContextPaneSidenavAdapter } from "./ContextPaneSidenavAdapter";
import {
  probeContextPane,
  type ContextPaneActiveState,
  type ContextPaneProbeResult,
  type ContextPaneProbeSuccess,
  type ContextPaneUnavailableResult,
} from "./contextPaneProbe";

type ContextPaneDeckAdapterOptions = {
  onActivate?: () => void;
  onDeactivate?: () => void;
};

const logger = createLogger("sidebar.contextPane");

class ContextPaneDeckAdapter {
  private panel?: Element;
  private sidenav?: ContextPaneSidenavAdapter;
  private unavailable?: ContextPaneUnavailableResult;
  private previousPanel?: Element;
  private hostState?: ContextPaneHostState;

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
        onActivate: () => this.options.onActivate?.(),
        onActivateNativePane: (state) => {
          this.select(state);
          this.options.onDeactivate?.();
        },
      });
    }
    this.sidenav.mount();
    this.unavailable = undefined;
    return probe;
  }

  getUnavailableResult(): ContextPaneUnavailableResult | undefined {
    return this.unavailable;
  }

  ensureVisible(): boolean {
    const probe = this.mount();
    if (!probe.available) return false;
    if (isElementVisible(probe.contextPane)) return true;
    const contextPane = (
      this.win as Window & {
        ZoteroContextPane?: { collapsed?: boolean };
      }
    ).ZoteroContextPane;
    if (!contextPane || typeof contextPane.collapsed !== "boolean") {
      return false;
    }
    if (!this.hostState) {
      this.hostState = {
        contextPane,
        collapsed: contextPane.collapsed,
      };
    }
    try {
      contextPane.collapsed = false;
      return contextPane.collapsed === false;
    } catch {
      this.restoreHostState();
      return false;
    }
  }

  restoreHostState(): void {
    const state = this.hostState;
    if (!state) return;
    if (state.contextPane.collapsed === false) {
      state.contextPane.collapsed = state.collapsed;
    }
    this.hostState = undefined;
  }

  getPanel(): Element | undefined {
    return this.panel?.ownerDocument === this.win.document &&
      this.panel.isConnected
      ? this.panel
      : undefined;
  }

  ensurePanel(): Element | undefined {
    const probe = this.mount();
    if (!probe.available) return undefined;
    const matches = Array.prototype.slice.call(
      this.win.document.querySelectorAll(`#${CONTEXT_PANE_DECK_ID}`),
    ) as Element[];
    const existing = matches.find(
      (element) => element.parentElement === probe.deck,
    );
    matches.forEach((element) => {
      if (element !== existing) element.remove();
    });
    if (existing) {
      this.panel = existing;
      return existing;
    }
    const panel = this.createPanel();
    probe.deck.append(panel);
    this.panel = panel;
    return panel;
  }

  select(state: ContextPaneActiveState): boolean {
    const probe = this.mount();
    if (!probe.available) return false;
    const panel =
      state === "zopilot"
        ? this.ensurePanel()
        : state === "notes"
          ? probe.notesDeck
          : probe.itemDeck;
    if (!panel) return false;
    if (state === "zopilot") {
      const selected = getSelectedPanel(probe);
      if (selected && selected !== panel) this.previousPanel = selected;
    }
    this.selectPanel(probe, panel);
    this.sidenav?.setActive(state === "zopilot");
    return true;
  }

  deactivate(): void {
    this.sidenav?.setActive(false);
  }

  focusPanel(): void {
    (
      this.getPanel() as (Element & { focus?: () => void }) | undefined
    )?.focus?.();
  }

  destroy(restoreHost = true): void {
    if (restoreHost) {
      this.restoreNativePanel();
      this.restoreHostState();
    }
    this.sidenav?.destroy();
    this.sidenav = undefined;
    this.panel?.remove();
    this.panel = undefined;
  }

  private createPanel(): Element {
    const doc = this.win.document;
    const createXULElement = (
      doc as Document & { createXULElement?: (tagName: string) => Element }
    ).createXULElement;
    const panel = (
      createXULElement
        ? createXULElement.call(doc, "vbox")
        : doc.createElementNS("http://www.w3.org/1999/xhtml", "section")
    ) as Element;
    panel.id = CONTEXT_PANE_DECK_ID;
    panel.className = "zp-context-pane-deck";
    panel.setAttribute("data-pane", ZOPILOT_CONTEXT_PANE);
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("tabindex", "-1");
    panel.setAttribute("flex", "1");
    panel.setAttribute("aria-label", getString("sidebar-title"));
    const style = (panel as Element & { style?: CSSStyleDeclaration }).style;
    if (style) {
      style.flex = "1 1 auto";
      style.minHeight = "0";
      style.height = "100%";
      style.overflow = "hidden";
    }
    return panel;
  }

  private selectPanel(probe: ContextPaneProbeSuccess, panel: Element): void {
    if (probe.selectionMode === "selectedPanel") {
      probe.deck.selectedPanel = panel as XUL.Deck["selectedPanel"];
      return;
    }
    const index = Array.prototype.indexOf.call(probe.deck.children, panel);
    if (index >= 0) probe.deck.selectedIndex = index;
  }

  restoreNativePanel(): void {
    const probe = probeContextPane(this.win.document);
    if (!probe.available || !this.panel) return;
    if (getSelectedPanel(probe) !== this.panel) return;
    const nativePanel =
      this.previousPanel?.parentElement === probe.deck
        ? this.previousPanel
        : probe.itemDeck;
    this.selectPanel(probe, nativePanel);
    this.sidenav?.setActive(false);
  }
}

type ContextPaneHostState = {
  contextPane: { collapsed?: boolean };
  collapsed: boolean;
};

function isElementVisible(element: Element): boolean {
  if (typeof element.getBoundingClientRect !== "function") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

function getSelectedPanel(probe: ContextPaneProbeSuccess): Element | null {
  if (probe.selectionMode === "selectedPanel") {
    return (probe.deck.selectedPanel as Element | null | undefined) || null;
  }
  const index = Number(probe.deck.selectedIndex || 0);
  return probe.deck.children.item(index);
}

export { ContextPaneDeckAdapter, ContextPaneSidenavAdapter };
