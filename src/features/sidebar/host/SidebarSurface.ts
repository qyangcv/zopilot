import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarActions, SidebarState } from "../ui/types";
import { ContextPaneDeckAdapter } from "./ContextPaneAdapter";
import { STYLE_URI } from "./constants";
import { createZopilotDeckHost, type ZopilotDeckHost } from "./deckHost";
import { LibraryItemPaneAdapter } from "./LibraryItemPaneAdapter";
import { LegacyReaderToolbarCleanup } from "./LegacyReaderToolbarCleanup";

const logger = createLogger("sidebar.surface");

type SidebarSurfaceOptions = {
  pluginID: string;
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
  private deckPanel?: HTMLElement;
  private activeKind?: SidebarSurfaceKind;
  private readonly toolbarCleanup: LegacyReaderToolbarCleanup;

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
    this.toolbarCleanup = new LegacyReaderToolbarCleanup({
      pluginID: options.pluginID,
    });
  }

  get panel(): HTMLElement | undefined {
    return this.deckPanel;
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
    this.toolbarCleanup.mount();
    this.deckAdapter.mount();
    this.libraryAdapter.mount();
    this.ensureMounted();
  }

  destroy(): void {
    this.deckHost?.destroy();
    this.deckHost = undefined;
    this.deckAdapter.destroy();
    this.libraryAdapter.destroy();
    this.styleNode?.remove();
    this.toolbarCleanup.destroy();
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
    this.toolbarCleanup.refresh();
  }

  attach(reader?: _ZoteroTypes.ReaderInstance): void {
    this.libraryAdapter.deactivate();
    this.ensureNativeContextPaneVisible(reader);
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
      this.deckAdapter.select("item");
      this.libraryAdapter.selectNative();
    }
    this.activeKind = undefined;
    this.deckPanel = undefined;
    this.toolbarCleanup.refresh();
  }

  refreshToolbar(): void {
    this.toolbarCleanup.refresh();
  }

  render(state: SidebarState, actions: SidebarActions): void {
    this.deckHost?.render(state, actions);
  }

  private injectStylesheet(): void {
    if (hasStylesheet(this.doc, STYLE_URI)) return;
    this.styleNode = this.doc.createProcessingInstruction(
      "xml-stylesheet",
      `href="${STYLE_URI}" type="text/css"`,
    );
    this.doc.insertBefore(this.styleNode, this.doc.documentElement);
  }

  private activatePanel(kind: SidebarSurfaceKind, panel: HTMLElement): void {
    this.activeKind = kind;
    this.deckPanel = panel;
    this.ensureDeckHost(panel);
  }

  private ensureDeckHost(panel: HTMLElement): void {
    if (this.deckHost) {
      this.deckHost.attach(panel);
      this.options.onReady();
      return;
    }
    this.deckHostCreation ??= this.createDeckHost(panel).finally(() => {
      this.deckHostCreation = undefined;
    });
  }

  private async createDeckHost(panel: HTMLElement): Promise<void> {
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

  private ensureNativeContextPaneVisible(
    reader?: _ZoteroTypes.ReaderInstance,
  ): void {
    if (isElementVisible(this.doc.getElementById("zotero-context-pane")))
      return;
    const readerWin = reader?._iframeWindow;
    const toggle = readerWin?.document?.querySelector(
      ".toolbar .end .context-pane-toggle",
    );
    if (readerWin && toggle instanceof readerWin.HTMLElement) {
      (toggle as HTMLElement).click();
    }
  }
}

function hasStylesheet(doc: Document, uri: string): boolean {
  return Array.from(doc.childNodes).some(
    (node) => node?.nodeType === 7 && node.nodeValue?.includes(uri),
  );
}

function isElementVisible(element: Element | null): boolean {
  if (!element || typeof element.getBoundingClientRect !== "function")
    return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 8 && rect.height > 8;
}

export { SidebarSurface };
export type { SidebarSurfaceKind, SidebarSurfaceOptions };
