import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarActions, SidebarState } from "../ui/types";
import {
  ContextPaneDeckAdapter,
  type ContextPaneActiveState,
} from "./ContextPaneAdapter";
import { STYLE_URI } from "./constants";
import { createZopilotDeckHost, type ZopilotDeckHost } from "./deckHost";
import { LegacyReaderToolbarCleanup } from "./LegacyReaderToolbarCleanup";

const logger = createLogger("sidebar.surface");

type SidebarSurfaceOptions = {
  pluginID: string;
  isDestroyed: () => boolean;
  isOpen: () => boolean;
  onDeckStateChange: (state: ContextPaneActiveState) => void;
  onUnavailable: () => void;
  onReady: () => void;
};

class SidebarSurface {
  private readonly doc: Document;
  private styleNode?: ProcessingInstruction;
  private readonly deckAdapter: ContextPaneDeckAdapter;
  private deckHost?: ZopilotDeckHost;
  private deckHostLoading = false;
  private deckPanel?: HTMLElement;
  private readonly toolbarCleanup: LegacyReaderToolbarCleanup;

  constructor(
    private readonly win: Window,
    private readonly options: SidebarSurfaceOptions,
  ) {
    this.doc = win.document;
    this.deckAdapter = new ContextPaneDeckAdapter(win, {
      onActiveStateChange: options.onDeckStateChange,
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
    this.ensureMounted();
  }

  destroy(): void {
    this.destroyDeckHost();
    this.deckAdapter.destroy();
    this.styleNode?.remove();
    this.toolbarCleanup.destroy();
  }

  ensureMounted(): void {
    this.deckAdapter.mount();
    if (this.options.isOpen()) this.attach();
    this.toolbarCleanup.refresh();
  }

  attach(reader?: _ZoteroTypes.ReaderInstance): void {
    this.ensureNativeContextPaneVisible(reader);
    this.mountPanel();
    this.deckAdapter.select("zopilot");
  }

  close(restoreItemPane = false): void {
    this.destroyDeckHost();
    if (restoreItemPane) this.deckAdapter.select("item");
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

  private mountPanel(): void {
    const panel = this.deckAdapter.ensurePanel();
    if (!panel) {
      logger.warn(
        "failed to mount Zopilot context pane deck",
        this.deckAdapter.getUnavailableResult(),
      );
      this.options.onUnavailable();
      return;
    }
    this.deckPanel = panel;
    this.ensureDeckHost(panel);
  }

  private ensureDeckHost(panel: HTMLElement): void {
    if (this.deckHost || this.deckHostLoading) return;
    this.deckHostLoading = true;
    void this.createDeckHost(panel);
  }

  private async createDeckHost(panel: HTMLElement): Promise<void> {
    let failed = false;
    try {
      if (this.options.isDestroyed() || this.deckPanel !== panel) return;
      const deckHost = await createZopilotDeckHost(panel);
      if (this.options.isDestroyed() || this.deckPanel !== panel) {
        deckHost.destroy();
        return;
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

  private destroyDeckHost(): void {
    this.deckHost?.destroy();
    this.deckHost = undefined;
    this.deckPanel = undefined;
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
export type { SidebarSurfaceOptions };
