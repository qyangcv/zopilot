import { READER_TOOLBAR_BUTTON_ID, STYLE_URI } from "./constants";
import { getString } from "../../utils/locale";
import { getOpenReaders, isPDFReader } from "../../zotero/reader";

export { ReaderToolbarController };

type ReaderToolbarControllerOptions = {
  pluginID: string;
  isOpenForReader: (reader: _ZoteroTypes.ReaderInstance) => boolean;
  onToggle: (reader: _ZoteroTypes.ReaderInstance) => void;
  isDestroyed: () => boolean;
};

class ReaderToolbarController {
  private readonly buttons = new Set<Element>();
  private readonly buttonReaders = new WeakMap<
    Element,
    _ZoteroTypes.ReaderInstance
  >();
  private readonly handler: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> =
    (event) => this.mountButton(event.reader, event.doc, event.append);

  constructor(private readonly options: ReaderToolbarControllerOptions) {}

  mount(): void {
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      this.handler,
      this.options.pluginID,
    );
    this.mountExistingReaderButtons();
  }

  destroy(): void {
    this.unregister();
    this.removeButtons();
  }

  refresh(): void {
    for (const button of this.buttons) {
      const reader = this.buttonReaders.get(button);
      const active = reader ? this.options.isOpenForReader(reader) : false;
      button.setAttribute("checked", String(active));
      button.setAttribute("aria-pressed", String(active));
      button.toggleAttribute("data-active", active);
    }
  }

  private mountExistingReaderButtons(): void {
    getOpenReaders().forEach((reader) => {
      void reader._initPromise?.then(() => {
        if (!this.options.isDestroyed()) {
          this.mountButton(reader);
        }
      });
    });
  }

  private mountButton(
    reader: _ZoteroTypes.ReaderInstance,
    doc = reader._iframeWindow?.document,
    append?: (button: HTMLButtonElement) => void,
  ): void {
    if (
      this.options.isDestroyed() ||
      !isPDFReader(reader) ||
      !doc ||
      doc.getElementById(READER_TOOLBAR_BUTTON_ID)
    ) {
      return;
    }

    const toolbar = append ? undefined : getReaderToolbar(doc);
    if (!append && !toolbar) {
      return;
    }

    const button = createReaderToolbarButton(
      doc,
      this.options.isOpenForReader(reader),
      () => this.options.onToggle(reader),
    );

    this.buttons.add(button);
    this.buttonReaders.set(button, reader);
    doc.defaultView?.addEventListener(
      "unload",
      () => this.buttons.delete(button),
      { once: true },
    );
    if (append) {
      append(button);
    } else {
      toolbar?.append(button);
    }
    positionReaderToolbarButton(doc, button);
  }

  private unregister(): void {
    const unregisterByPluginID = (
      Zotero.Reader as typeof Zotero.Reader & {
        _unregisterEventListenerByPluginID?: (pluginID: string) => void;
      }
    )._unregisterEventListenerByPluginID;
    unregisterByPluginID?.call(Zotero.Reader, this.options.pluginID);
  }

  private removeButtons(): void {
    this.buttons.forEach((button) => button.remove());
    this.buttons.clear();

    getOpenReaders().forEach((reader) => {
      reader._iframeWindow?.document
        ?.getElementById(READER_TOOLBAR_BUTTON_ID)
        ?.remove();
    });
  }
}

function createReaderToolbarButton(
  doc: Document,
  open: boolean,
  onClick: () => void,
): HTMLButtonElement {
  injectReaderToolbarStylesheet(doc);

  const button = doc.createElement("button");
  button.id = READER_TOOLBAR_BUTTON_ID;
  button.className = "zcp-reader-toolbar-button";
  button.type = "button";
  button.title = getString("sidebar-toggle-tooltip");
  button.setAttribute("aria-label", getString("sidebar-toggle-tooltip"));
  button.setAttribute("aria-pressed", String(open));

  const icon = doc.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  button.addEventListener("click", onClick);

  return button;
}

function injectReaderToolbarStylesheet(doc: Document): void {
  const links = Array.from(
    doc.querySelectorAll('link[rel="stylesheet"]'),
  ) as HTMLLinkElement[];

  if (links.some((link) => link.getAttribute("href") === STYLE_URI)) {
    return;
  }
  const link = doc.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", STYLE_URI);
  doc.head?.appendChild(link);
}

function getReaderToolbar(doc: Document): Element | undefined {
  return (
    doc.querySelector(".toolbar .end") ||
    doc.querySelector(".toolbar") ||
    undefined
  );
}

function positionReaderToolbarButton(
  doc: Document,
  button: HTMLButtonElement,
): void {
  const anchor =
    doc.querySelector(".toolbar .end .context-pane-toggle") ||
    doc.querySelector(".toolbar .end .find");
  anchor?.parentNode?.insertBefore(button, anchor.nextSibling);
}
