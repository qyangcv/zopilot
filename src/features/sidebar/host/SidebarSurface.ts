import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarActions, SidebarState } from "../ui/types";
import { ContextPaneDeckAdapter } from "./ContextPaneAdapter";
import { STYLE_URI } from "./constants";
import { createZopilotDeckHost, type ZopilotDeckHost } from "./deckHost";
import { LibraryItemPaneAdapter } from "./LibraryItemPaneAdapter";
import type { HostMutationTargets } from "./HostMutationCoordinator";

const logger = createLogger("sidebar.surface");

type SidebarSurfaceOptions = {
  isDestroyed: () => boolean;
  isOpen: () => boolean;
  onActiveSurfaceChange: (kind: SidebarSurfaceKind, active: boolean) => void;
  onUnavailable: () => void;
  onReady: () => void;
};

type SidebarSurfaceKind = "reader" | "library";

class SidebarSurface {
  private readonly doc: Document;
  private styleNode?: ProcessingInstruction;
  private readonly deckAdapter: ContextPaneDeckAdapter;
  private readonly libraryAdapter: LibraryItemPaneAdapter;
  private deckHost?: ZopilotDeckHost;
  private deckHostCreation?: Promise<void>;
  private deckPanel?: Element;
  private activeKind?: SidebarSurfaceKind;

  constructor(
    private readonly win: Window,
    private readonly options: SidebarSurfaceOptions,
  ) {
    this.doc = win.document;
    this.deckAdapter = new ContextPaneDeckAdapter(win, {
      onActivate: () => this.requestActivation("reader"),
      onDeactivate: () => this.requestDeactivation("reader"),
    });
    this.libraryAdapter = new LibraryItemPaneAdapter(win, {
      onActivate: () => this.requestActivation("library"),
      onDeactivate: () => this.requestDeactivation("library"),
    });
  }

  get panel(): Element | undefined {
    return this.deckPanel;
  }

  getHostMutationTargets(): HostMutationTargets {
    const byID = (id: string) => this.doc.getElementById(id);
    const childList = [
      byID("zotero-pane"),
      byID("zotero-context-pane"),
      byID("zotero-context-pane-inner"),
      byID("zotero-context-pane-deck"),
      byID("zotero-context-pane-sidenav"),
      byID("zotero-item-pane"),
      byID("zotero-item-pane-content"),
      byID("zotero-view-item-sidenav"),
    ].filter((element): element is Element => Boolean(element));
    const attributes: HostMutationTargets["attributes"] = [];
    const contextPane = byID("zotero-context-pane");
    if (contextPane) {
      attributes.push({ element: contextPane, names: ["collapsed"] });
    }
    const itemPane = byID("zotero-item-pane");
    if (itemPane) {
      attributes.push({
        element: itemPane,
        names: ["collapsed", "view-type"],
      });
    }
    return { attributes, childList };
  }

  isActive(kind: SidebarSurfaceKind): boolean {
    const panel =
      kind === "reader"
        ? this.deckAdapter.getPanel()
        : this.libraryAdapter.getPanel();
    return Boolean(
      this.activeKind === kind &&
      panel?.isConnected &&
      this.deckPanel === panel &&
      this.deckHost?.isAttachedTo(panel),
    );
  }

  mount(): void {
    this.injectStylesheet();
    this.deckAdapter.mount();
    this.libraryAdapter.mount();
    this.ensureMounted();
  }

  destroy(options: { restoreHost?: boolean } = { restoreHost: true }): void {
    this.deckHost?.destroy();
    this.deckHost = undefined;
    this.deckPanel = undefined;
    this.activeKind = undefined;
    this.deckAdapter.destroy(Boolean(options.restoreHost));
    this.libraryAdapter.destroy(Boolean(options.restoreHost));
    this.styleNode?.remove();
    this.styleNode = undefined;
  }

  ensureMounted(): void {
    this.deckAdapter.mount();
    this.libraryAdapter.mount();
    if (
      this.options.isOpen() &&
      this.activeKind &&
      !this.isActive(this.activeKind)
    ) {
      if (this.activeKind === "reader") {
        this.attach();
      } else {
        this.attachLibrary();
      }
    }
  }

  attach(_reader?: _ZoteroTypes.ReaderInstance): void {
    this.libraryAdapter.deactivate();
    if (!this.deckAdapter.ensureVisible()) {
      logger.warn("failed to open Zotero context pane compatibility host");
      this.deckAdapter.restoreHostState();
      this.options.onUnavailable();
      return;
    }
    this.deckAdapter.select("zopilot");
    const panel = this.deckAdapter.ensurePanel();
    if (!panel) {
      logger.warn(
        "failed to mount Zopilot context pane deck",
        this.deckAdapter.getUnavailableResult(),
      );
      this.options.onUnavailable();
      return;
    }
    this.activatePanel("reader", panel);
  }

  attachLibrary(): void {
    const mountedPanel = this.libraryAdapter.getPanel();
    if (
      this.activeKind === "library" &&
      this.deckPanel === mountedPanel &&
      mountedPanel?.isConnected
    ) {
      this.libraryAdapter.ensureActiveSelection();
      this.ensureDeckHost(mountedPanel);
      return;
    }
    this.deckAdapter.deactivate();
    const selected = this.libraryAdapter.selectZopilot();
    const panel = this.libraryAdapter.ensurePanel();
    if (!selected || !panel) {
      logger.warn(
        "failed to mount Zopilot library item pane deck",
        this.libraryAdapter.getUnavailableResult(),
      );
      this.options.onUnavailable();
      return;
    }
    this.activatePanel("library", panel);
  }

  close(restoreItemPane = false): void {
    if (restoreItemPane) {
      this.deckAdapter.restoreNativePanel();
      this.libraryAdapter.selectNative();
    }
    this.activeKind = undefined;
    this.deckPanel = undefined;
    if (restoreItemPane) {
      this.deckAdapter.restoreHostState();
      this.libraryAdapter.restoreHostState();
    }
  }

  refreshToolbar(): void {
    // Kept as a stable controller hook; legacy Reader toolbar integration was
    // removed because there is no remaining registration source.
  }

  render(state: SidebarState, actions: SidebarActions): void {
    this.deckHost?.render(state, actions);
  }

  private injectStylesheet(): void {
    const existing = findStylesheets(this.doc, STYLE_URI);
    existing.slice(1).forEach((node) => node.remove());
    if (existing[0]) {
      this.styleNode = existing[0];
      return;
    }
    this.styleNode = this.doc.createProcessingInstruction(
      "xml-stylesheet",
      `href="${STYLE_URI}" type="text/css"`,
    );
    this.doc.insertBefore(this.styleNode, this.doc.documentElement);
  }

  private activatePanel(kind: SidebarSurfaceKind, panel: Element): void {
    this.activeKind = kind;
    this.deckPanel = panel;
    this.ensureDeckHost(panel);
  }

  private ensureDeckHost(panel: Element): void {
    if (this.deckHost) {
      if (this.deckHost.attach(panel)) this.options.onReady();
      return;
    }
    this.deckHostCreation ??= this.createDeckHost(panel).finally(() => {
      this.deckHostCreation = undefined;
    });
  }

  private async createDeckHost(panel: Element): Promise<void> {
    try {
      if (this.options.isDestroyed() || this.deckPanel !== panel) return;
      const deckHost = await createZopilotDeckHost(panel);
      if (this.options.isDestroyed()) {
        deckHost.destroy();
        return;
      }
      const currentPanel = this.deckPanel;
      if (!currentPanel?.isConnected) {
        deckHost.destroy();
        return;
      }
      deckHost.attach(currentPanel);
      this.deckHost = deckHost;
      this.options.onReady();
    } catch (error) {
      logger.error("failed to mount Zopilot React deck", error);
    }
  }

  private requestActivation(kind: SidebarSurfaceKind): void {
    this.options.onActiveSurfaceChange(kind, true);
  }

  private requestDeactivation(kind: SidebarSurfaceKind): void {
    if (this.activeKind !== kind) return;
    this.activeKind = undefined;
    this.deckPanel = undefined;
    this.options.onActiveSurfaceChange(kind, false);
  }
}

function findStylesheets(doc: Document, uri: string): ProcessingInstruction[] {
  return Array.from(doc.childNodes).filter(
    (node): node is ProcessingInstruction =>
      node?.nodeType === 7 && Boolean(node.nodeValue?.includes(uri)),
  );
}

export { SidebarSurface };
export type { SidebarSurfaceKind, SidebarSurfaceOptions };
