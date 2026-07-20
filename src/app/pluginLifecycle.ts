import { config } from "../../package.json";
import type { SidebarReloadContext } from "../features/sidebar/ui/types";
import { loadAddonManagerModule } from "../platform/gecko";

const LIFECYCLE_STATE_KEY = "__zopilotLifecycleState__";

type ReloadableAddon = {
  reload?: () => Promise<void>;
};

type AddonManager = {
  getAddonByID(id: string): Promise<ReloadableAddon | null>;
};

type AddonManagerLoader = () => AddonManager;

type PluginLifecycleState = {
  shutdownPromise?: Promise<void>;
  reloadContext?: SidebarReloadContext;
  reloadPromise?: Promise<void>;
};

type ZoteroLifecycleRegistry = typeof Zotero & {
  [LIFECYCLE_STATE_KEY]?: PluginLifecycleState;
};

function getPluginLifecycleState(): PluginLifecycleState {
  const registry = Zotero as ZoteroLifecycleRegistry;
  registry[LIFECYCLE_STATE_KEY] ??= {};
  return registry[LIFECYCLE_STATE_KEY];
}

async function requestPluginReload(
  context: SidebarReloadContext,
  loadAddonManager: AddonManagerLoader = loadZoteroAddonManager,
): Promise<void> {
  const lifecycle = getPluginLifecycleState();
  if (lifecycle.reloadPromise) {
    return lifecycle.reloadPromise;
  }

  const operation = (async () => {
    const manager = loadAddonManager();
    const installedAddon = await manager.getAddonByID(config.addonID);
    if (!installedAddon || typeof installedAddon.reload !== "function") {
      throw new Error("Zotero Add-on Manager cannot reload Zopilot.");
    }

    const reloadContext: SidebarReloadContext = {
      workspaceKey: context.workspaceKey,
      conversationId: context.conversationId,
      hostContextKind: context.hostContextKind,
    };
    lifecycle.reloadContext = reloadContext;
    try {
      await installedAddon.reload();
    } catch (error) {
      if (lifecycle.reloadContext === reloadContext) {
        delete lifecycle.reloadContext;
      }
      throw error;
    }
  })();

  lifecycle.reloadPromise = operation;
  operation.then(
    () => {
      if (lifecycle.reloadPromise === operation) {
        delete lifecycle.reloadPromise;
      }
    },
    () => {
      if (lifecycle.reloadPromise === operation) {
        delete lifecycle.reloadPromise;
      }
    },
  );
  return operation;
}

function consumeReloadContext(
  workspaceKey: string | undefined,
  conversationId: string | undefined,
): SidebarReloadContext | undefined {
  const lifecycle = getPluginLifecycleState();
  const context = lifecycle.reloadContext;
  if (
    !context ||
    context.workspaceKey !== workspaceKey ||
    context.conversationId !== conversationId
  ) {
    return undefined;
  }
  delete lifecycle.reloadContext;
  return context;
}

function peekReloadContext(): SidebarReloadContext | undefined {
  return getPluginLifecycleState().reloadContext;
}

function loadZoteroAddonManager(): AddonManager {
  const module = loadAddonManagerModule<{ AddonManager?: AddonManager }>();
  if (!module.AddonManager) {
    throw new Error("Zotero Add-on Manager is unavailable.");
  }
  return module.AddonManager;
}

const __pluginLifecycleTestHooks = {
  getPluginLifecycleState,
};

export {
  LIFECYCLE_STATE_KEY,
  __pluginLifecycleTestHooks,
  consumeReloadContext,
  peekReloadContext,
  requestPluginReload,
};
export type { AddonManager, AddonManagerLoader, PluginLifecycleState };
