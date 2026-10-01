import { initLocale } from "./localization";
import { registerPreferencePane } from "../features/preferences/registerPreferencePane";
import {
  prepareAllSidebarsForShutdown,
  registerSidebar,
  unregisterAllSidebars,
  unregisterSidebar,
} from "../features/sidebar/host/SidebarHostController";
import {
  getCodexBridge,
  shutdownCodexBridge,
} from "../integrations/codex/CodexBridge";
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
import { registerReaderRegionMenu } from "../integrations/zotero/readerRegionMenu";
import { askAboutRegion } from "../features/sidebar/host/SidebarHostController";
import { getString } from "./localization";
import {
  getThreadStore,
  shutdownThreadStore,
} from "../runtime/persistence/threads/ThreadService";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;

const logger = createLogger("hooks");
let shutdownPromise: Promise<void> | undefined;
let unregisterReaderRegionMenu: (() => void) | undefined;

async function onStartup(): Promise<void> {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  migrateLegacyProviderPrefs();
  await getThreadStore().initialize();
  await getThreadStore().recoverInFlightTurns({
    readCodexTurn: (binding, turn) => getCodexBridge().readTurn(binding, turn),
  });

  registerPreferencePane();
  unregisterReaderRegionMenu = registerReaderRegionMenu(
    (reader, target, attachment) => askAboutRegion(reader, target, attachment),
    (error) => {
      const messageID = {
        unavailable: "reader-region-unavailable",
        "too-large": "reader-region-too-large",
        "copy-failed": "reader-region-copy-failed",
        sidebar_unavailable: "reader-region-sidebar-unavailable",
        "attachment-limit": "reader-region-attachment-limit",
      } as const;
      Services.prompt.alert(
        Zotero.getMainWindow() as unknown as mozIDOMWindowProxy,
        getString("sidebar-title"),
        getString(messageID[error.code]),
      );
    },
  );

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
  unregisterReaderRegionMenu?.();
  unregisterReaderRegionMenu = undefined;
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
    shutdownThreadStore(),
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
