import "./utils/consoleShim";
import Addon from "./addon";
import { config } from "../package.json";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const zotero = Zotero as ZoteroPluginRegistry;

if (!zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();
  Object.defineProperty(_globalThis, "ztoolkit", {
    get() {
      return _globalThis.addon.data.ztoolkit;
    },
  });
  zotero[config.addonInstance] = addon;
}
