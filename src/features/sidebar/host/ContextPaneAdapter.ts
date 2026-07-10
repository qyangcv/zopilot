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
  onActiveStateChange?: (state: ContextPaneActiveState) => void;
};

const logger = createLogger("sidebar.contextPane");

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
    if (!probe.available) return undefined;
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
    if (!probe.available) return false;
    const panel =
      state === "zopilot"
        ? this.ensurePanel()
        : state === "notes"
          ? probe.notesDeck
          : probe.itemDeck;
    if (!panel) return false;
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
      doc as Document & { createXULElement?: (tagName: string) => Element }
    ).createXULElement;
    const panel = (
      createXULElement
        ? createXULElement.call(doc, "vbox")
        : doc.createElementNS("http://www.w3.org/1999/xhtml", "section")
    ) as HTMLElement | XUL.Box;
    panel.id = CONTEXT_PANE_DECK_ID;
    panel.className = "zp-context-pane-deck";
    panel.setAttribute("data-pane", ZOPILOT_CONTEXT_PANE);
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
    if (index >= 0) probe.deck.selectedIndex = index;
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

export { ContextPaneDeckAdapter, ContextPaneSidenavAdapter, probeContextPane };
export type {
  ContextPaneActiveState,
  ContextPaneProbeResult,
  ContextPaneProbeSuccess,
  ContextPaneUnavailableResult,
};
