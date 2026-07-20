var chromeHandle;
var LIFECYCLE_STATE_KEY = "__zopilotLifecycleState__";

function install() {}

async function startup({ rootURI }) {
  var lifecycleState = getLifecycleState();
  var previousShutdown = lifecycleState.shutdownPromise;
  if (previousShutdown) {
    await previousShutdown.catch((error) => Zotero.logError(error));
    if (lifecycleState.shutdownPromise === previousShutdown) {
      delete lifecycleState.shutdownPromise;
    }
  }

  var aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  const ctx = { rootURI };
  ctx._globalThis = ctx;

  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js`,
    ctx,
  );
  await Zotero.__addonInstance__.hooks.onStartup();
}

function onMainWindowLoad({ window }) {
  Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

function shutdown(_data, reason) {
  var pendingShutdown;
  try {
    pendingShutdown = Promise.resolve(
      Zotero.__addonInstance__?.hooks.onShutdown(),
    );
  } catch (error) {
    pendingShutdown = Promise.reject(error);
  }

  pendingShutdown.catch((error) => Zotero.logError(error));
  if (reason !== APP_SHUTDOWN) {
    getLifecycleState().shutdownPromise = pendingShutdown;
  }

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }

  if (reason !== APP_SHUTDOWN) {
    return pendingShutdown;
  }
}

function uninstall() {}

function getLifecycleState() {
  return (Zotero[LIFECYCLE_STATE_KEY] ||= {});
}
