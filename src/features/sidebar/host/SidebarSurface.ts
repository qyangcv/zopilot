import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarActions, SidebarState } from "../ui/types";
import {
  ContextPaneDeckAdapter,
  type ContextPaneActiveState,
} from "./ContextPaneAdapter";
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
  private deckHostLoading = false;
  private deckPanel?: HTMLElement;
  private activeKind?: SidebarSurfaceKind;
  private transitioning = false;
  private readonly toolbarCleanup: LegacyReaderToolbarCleanup;

  constructor(
    private readonly win: Window,
    private readonly options: SidebarSurfaceOptions,
  ) {
    this.doc = win.document;
    this.deckAdapter = new ContextPaneDeckAdapter(win, {
      onActiveStateChange: (state) => this.handleReaderStateChange(state),
    });
    this.libraryAdapter = new LibraryItemPaneAdapter(win, {
      onActiveChange: (active) =>
        this.handleAdapterStateChange("library", active),
    });
    this.toolbarCleanup = new LegacyReaderToolbarCleanup({
      pluginID: options.pluginID,
    });
  }

  get panel(): HTMLElement | undefined {
    return this.deckPanel;
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
    if (this.options.isOpen()) {
      if (this.activeKind === "reader") this.attach();
      if (this.activeKind === "library") this.attachLibrary();
    }
    this.toolbarCleanup.refresh();
  }

  attach(reader?: _ZoteroTypes.ReaderInstance): void {
    this.transitioning = true;
    this.ensureNativeContextPaneVisible(reader);
    this.deckAdapter.select("zopilot");
    const panel = this.deckAdapter.ensurePanel();
    this.transitioning = false;
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
    this.transitioning = true;
    const selected = this.libraryAdapter.selectZopilot();
    const panel = this.libraryAdapter.ensurePanel();
    this.transitioning = false;
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
    this.transitioning = true;
    if (restoreItemPane) {
      this.deckAdapter.select("item");
      this.libraryAdapter.selectNative();
    }
    this.transitioning = false;
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
    if (this.deckHostLoading) return;
    this.deckHostLoading = true;
    void this.createDeckHost(panel);
  }

  private async createDeckHost(panel: HTMLElement): Promise<void> {
    let failed = false;
    try {
      if (this.options.isDestroyed() || this.deckPanel !== panel) return;
      const deckHost = await createZopilotDeckHost(panel);
      if (this.options.isDestroyed() || this.deckPanel !== panel) {
        const currentPanel = this.deckPanel;
        if (!this.options.isDestroyed() && currentPanel) {
          deckHost.attach(currentPanel);
        } else {
          deckHost.destroy();
          return;
        }
      }
      this.deckHost = deckHost;
      this.options.onReady();
    } catch (error) {
      failed = true;
      logger.error("failed to mount Zopilot React deck", error);
    } finally {
      this.deckHostLoading = false;
      if (
        !failed &&
        this.options.isOpen() &&
        !this.deckHost &&
        this.deckPanel
      ) {
        this.ensureDeckHost(this.deckPanel);
      }
    }
  }

  private handleReaderStateChange(state: ContextPaneActiveState): void {
    this.handleAdapterStateChange("reader", state === "zopilot");
  }

  private handleAdapterStateChange(
    kind: SidebarSurfaceKind,
    active: boolean,
  ): void {
    if (this.transitioning) return;
    if (active) {
      if (kind === "reader") this.attach();
      else this.attachLibrary();
    } else if (this.activeKind === kind) {
      this.activeKind = undefined;
      this.deckPanel = undefined;
    }
    this.options.onActiveSurfaceChange(kind, active);
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
