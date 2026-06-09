import { getString, initLocale } from "./utils/locale";
import { registerPreferencePane } from "./modules/preferenceScript";
import {
  cleanupPersistedSidebarPaneState,
  registerSidebar,
  unregisterAllSidebars,
  unregisterSidebar,
} from "./modules/sidebar";
import { shutdownCodexBridge } from "./codex/bridge";
import { shutdownMcpHttpServer, startMcpHttpServer } from "./mcp/httpServer";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  cleanupPersistedSidebarPaneState();

  registerPreferencePane();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  await startMcpHttpServer().catch((error) => {
    ztoolkit.log("failed to start zotero copilot mcp server", String(error));
  });

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  try {
    registerSidebar(win);
  } catch (error) {
    ztoolkit.log("failed to register sidebar", error);
  }

  ztoolkit.log(getString("startup-finish"));
}

async function onMainWindowUnload(win: Window): Promise<void> {
  unregisterSidebar(win);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterAllSidebars();
  shutdownMcpHttpServer();
  void shutdownCodexBridge();
  ztoolkit.unregisterAll();
  // Remove addon object
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      ztoolkit.log("preference pane loaded", data.window);
      break;
    default:
      return;
  }
}

function onShortcuts(type: string) {
  ztoolkit.log("shortcut event", type);
}

function onDialogEvents(type: string) {
  ztoolkit.log("dialog event", type);
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
  onShortcuts,
  onDialogEvents,
};
