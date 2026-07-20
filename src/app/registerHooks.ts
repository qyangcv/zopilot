import { initLocale } from "./localization";
import { registerPreferencePane } from "../features/preferences/registerPreferencePane";
import {
  prepareAllSidebarsForShutdown,
  registerSidebar,
  unregisterAllSidebars,
  unregisterSidebar,
} from "../features/sidebar/host/SidebarHostController";
import { shutdownCodexBridge } from "../integrations/codex/CodexBridge";
import {
  migrateLegacyProviderPrefs,
  shutdownProviderProfileStore,
} from "../application/providers/ProviderProfileService";
import { shutdownAgentBackends } from "../application/agent/BackendManager";
import { shutdownByokRuntimeBridge } from "../integrations/byok/ByokRuntimeBridge";
import {
  shutdownMcpHttpServer,
  startMcpHttpServer,
} from "../integrations/mcp/httpServer";
import { createLogger } from "../runtime/logging/logger";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const logger = createLogger("hooks");
let shutdownPromise: Promise<void> | undefined;

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
  try {
    registerSidebar(win);
  } catch (error) {
    logger.error("failed to register sidebar", error);
  }
}

function onMainWindowUnload(win: Window): void {
  unregisterSidebar(win, { restoreHost: false });
}

function onShutdown(): Promise<void> {
  shutdownPromise ??= performShutdown();
  return shutdownPromise;
}

async function performShutdown(): Promise<void> {
  const sidebarSettlement = prepareAllSidebarsForShutdown();
  const runtimeResults = await Promise.allSettled([
    sidebarSettlement,
    shutdownAgentBackends(),
    shutdownByokRuntimeBridge(),
    shutdownCodexBridge(),
  ]);
  logCleanupFailures(runtimeResults);

  const singletonResults = await Promise.allSettled([
    Promise.resolve().then(() => unregisterAllSidebars()),
    Promise.resolve().then(() => shutdownMcpHttpServer()),
    Promise.resolve().then(() => shutdownProviderProfileStore()),
  ]);
  logCleanupFailures(singletonResults);
  delete (Zotero as ZoteroPluginRegistry)[addon.data.config.addonInstance];
}

function logCleanupFailures(results: PromiseSettledResult<unknown>[]): void {
  results.forEach((result) => {
    if (result.status === "rejected") {
      logger.error(
        "failed to release a Zopilot runtime resource",
        result.reason,
      );
    }
  });
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
};
