import { READER_TOOLBAR_BUTTON_ID } from "./constants";
import { getOpenReaders } from "../../zotero/reader";

export { ReaderToolbarController };

type ReaderToolbarControllerOptions = {
  pluginID: string;
};

class ReaderToolbarController {
  constructor(private readonly options: ReaderToolbarControllerOptions) {}

  mount(): void {
    this.unregister();
    this.removeButtons();
  }

  destroy(): void {
    this.unregister();
    this.removeButtons();
  }

  refresh(): void {
    this.removeButtons();
  }

  private unregister(): void {
    const reader = (globalThis as { Zotero?: typeof Zotero }).Zotero?.Reader;
    if (!reader) {
      return;
    }
    const unregisterByPluginID = (
      reader as typeof Zotero.Reader & {
        _unregisterEventListenerByPluginID?: (pluginID: string) => void;
      }
    )._unregisterEventListenerByPluginID;
    unregisterByPluginID?.call(reader, this.options.pluginID);
  }

  private removeButtons(): void {
    if (!(globalThis as { Zotero?: typeof Zotero }).Zotero?.Reader) {
      return;
    }
    getOpenReaders().forEach((reader) => {
      reader._iframeWindow?.document
        ?.getElementById(READER_TOOLBAR_BUTTON_ID)
        ?.remove();
    });
  }
}
