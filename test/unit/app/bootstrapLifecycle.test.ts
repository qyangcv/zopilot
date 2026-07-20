import { assert } from "chai";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const bootstrapSource = readFileSync(
  new URL("../../../addon/bootstrap.js", import.meta.url),
  "utf8",
);

describe("bootstrap lifecycle barrier", function () {
  it("waits for the previous shutdown before registering and starting", async function () {
    const previousShutdown = deferred<void>();
    const calls: string[] = [];
    const context = createBootstrapContext(calls);
    context.Zotero.__zopilotLifecycleState__ = {
      shutdownPromise: previousShutdown.promise,
    };
    runInNewContext(bootstrapSource, context);

    const startup = context.startup({ rootURI: "resource://zopilot/" });
    await Promise.resolve();
    assert.deepEqual(calls, []);

    previousShutdown.resolve();
    await startup;
    assert.deepEqual(calls, ["registerChrome", "loadSubScript", "onStartup"]);
    assert.isUndefined(
      context.Zotero.__zopilotLifecycleState__.shutdownPromise,
    );
  });

  it("publishes the shutdown promise before a non-app reload continues", async function () {
    const shutdown = deferred<void>();
    const calls: string[] = [];
    const context = createBootstrapContext(calls, shutdown.promise);
    runInNewContext(bootstrapSource, context);
    await context.startup({ rootURI: "resource://zopilot/" });

    const pending = context.shutdown({}, context.ADDON_DISABLE);
    assert.strictEqual(
      context.Zotero.__zopilotLifecycleState__.shutdownPromise,
      pending,
    );
    assert.include(calls, "destructChrome");

    shutdown.resolve();
    await pending;
  });

  it("starts best-effort cleanup without publishing a restart barrier on app exit", function () {
    const calls: string[] = [];
    const context = createBootstrapContext(calls, Promise.resolve());
    runInNewContext(bootstrapSource, context);

    const result = context.shutdown({}, context.APP_SHUTDOWN);
    assert.isUndefined(result);
    assert.include(calls, "onShutdown");
    assert.isUndefined(context.Zotero.__zopilotLifecycleState__);
  });
});

function createBootstrapContext(
  calls: string[],
  shutdownPromise: Promise<void> = Promise.resolve(),
): Record<string, any> {
  const hooks = {
    async onStartup() {
      calls.push("onStartup");
    },
    onShutdown() {
      calls.push("onShutdown");
      return shutdownPromise;
    },
    onMainWindowLoad() {},
    onMainWindowUnload() {},
  };
  return {
    ADDON_DISABLE: 4,
    APP_SHUTDOWN: 2,
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService() {
            return {
              registerChrome() {
                calls.push("registerChrome");
                return {
                  destruct() {
                    calls.push("destructChrome");
                  },
                };
              },
            };
          },
        },
      },
      interfaces: {
        amIAddonManagerStartup: {},
      },
    },
    Promise,
    Services: {
      io: {
        newURI(value: string) {
          return value;
        },
      },
      scriptloader: {
        loadSubScript() {
          calls.push("loadSubScript");
        },
      },
    },
    Zotero: {
      __addonInstance__: { hooks },
      logError() {},
    },
  };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
