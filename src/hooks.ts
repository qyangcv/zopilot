import { initLocale } from "./utils/locale";
import { registerPreferencePane } from "./modules/preferenceScript";
import {
  registerSidebar,
  unregisterAllSidebars,
  unregisterSidebar,
} from "./modules/sidebar/controller";
import { shutdownCodexBridge } from "./codex/bridge";
import { shutdownMcpHttpServer, startMcpHttpServer } from "./mcp/httpServer";
import { createZToolkit } from "./utils/ztoolkit";
import { createLogger } from "./utils/logger";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const logger = createLogger("hooks");

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerPreferencePane();

  Zotero.getMainWindows().forEach((win) => onMainWindowLoad(win));

  await startMcpHttpServer().catch((error) => {
    logger.error("failed to start zopilot mcp server", error);
  });

  addon.data.initialized = true;
}

function onMainWindowLoad(win: _ZoteroTypes.MainWindow): void {
  addon.data.ztoolkit = createZToolkit();

  try {
    registerSidebar(win);
  } catch (error) {
    logger.error("failed to register sidebar", error);
  }
}

function onMainWindowUnload(win: Window): void {
  unregisterSidebar(win);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  unregisterAllSidebars();
  shutdownMcpHttpServer();
  void shutdownCodexBridge();
  ztoolkit.unregisterAll();
  delete (Zotero as ZoteroPluginRegistry)[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
