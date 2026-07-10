import { initLocale } from "./localization";
import { registerPreferencePane } from "../features/preferences/registerPreferencePane";
import {
  registerSidebar,
  unregisterAllSidebars,
  unregisterSidebar,
} from "../features/sidebar/host/SidebarHostController";
import { shutdownCodexBridge } from "../integrations/codex/CodexBridge";
import { migrateLegacyProviderPrefs } from "../application/providers/ProviderProfileService";
import { shutdownAgentBackends } from "../application/agent/BackendManager";
import { shutdownByokRuntimeBridge } from "../integrations/byok/ByokRuntimeBridge";
import {
  shutdownMcpHttpServer,
  startMcpHttpServer,
} from "../integrations/mcp/httpServer";
import { createZToolkit } from "../integrations/zotero/ztoolkit";
import { createLogger } from "../runtime/logging/logger";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const logger = createLogger("hooks");

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  migrateLegacyProviderPrefs();

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
  shutdownAgentBackends();
  void shutdownByokRuntimeBridge();
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
