import "../runtime/console/consoleShim";
import Addon from "./ZopilotAddon";
import { config } from "../../package.json";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const zotero = Zotero as ZoteroPluginRegistry;

if (!zotero[config.addonInstance]) {
  _globalThis.addon = new Addon();
  _globalThis.addon.data.rootURI =
    typeof rootURI === "string" ? rootURI : undefined;
  zotero[config.addonInstance] = addon;
}
