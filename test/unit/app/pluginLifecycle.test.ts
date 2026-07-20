import { assert } from "chai";
import {
  consumeReloadContext,
  requestPluginReload,
} from "../../../src/app/pluginLifecycle.ts";
import type { SidebarReloadContext } from "../../../src/features/sidebar/ui/types.ts";

const LIFECYCLE_STATE_KEY = "__zopilotLifecycleState__";

describe("plugin lifecycle reload", function () {
  beforeEach(function () {
    (
      globalThis as typeof globalThis & { Zotero: Record<string, unknown> }
    ).Zotero = {};
  });

  afterEach(function () {
    delete (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero;
  });

  it("reloads the installed add-on and hands off only navigation context", async function () {
    let reloadCount = 0;
    await requestPluginReload(
      {
        ...createReloadContext(),
        text: "must not survive reload",
        mentions: [{ sourceId: "source-1" }],
        localAttachments: [{ path: "/tmp/private.pdf" }],
      } as SidebarReloadContext,
      () => ({
        async getAddonByID() {
          return {
            async reload() {
              reloadCount += 1;
            },
          };
        },
      }),
    );

    assert.equal(reloadCount, 1);
    assert.isUndefined(consumeReloadContext("library:2", "conversation-a"));
    assert.deepEqual(
      consumeReloadContext("library:1", "conversation-a"),
      createReloadContext(),
    );
    assert.isUndefined(consumeReloadContext("library:1", "conversation-a"));
  });

  it("coalesces concurrent reload requests", async function () {
    let reloadCount = 0;
    let releaseReload: (() => void) | undefined;
    const blockedReload = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    const loader = () => ({
      async getAddonByID() {
        return {
          async reload() {
            reloadCount += 1;
            await blockedReload;
          },
        };
      },
    });

    const first = requestPluginReload(createReloadContext(), loader);
    const second = requestPluginReload(createReloadContext(), loader);
    await Promise.resolve();
    assert.equal(reloadCount, 1);
    releaseReload?.();
    await Promise.all([first, second]);
  });

  it("clears the handoff and remains retryable when reload fails", async function () {
    const error = new Error("reload failed");
    await assertRejects(
      requestPluginReload(createReloadContext(), () => ({
        async getAddonByID() {
          return {
            async reload() {
              throw error;
            },
          };
        },
      })),
      "reload failed",
    );

    const lifecycle = (
      globalThis as typeof globalThis & {
        Zotero: Record<string, Record<string, unknown>>;
      }
    ).Zotero[LIFECYCLE_STATE_KEY];
    assert.isUndefined(lifecycle.reloadContext);
    assert.isUndefined(lifecycle.reloadPromise);

    let retryCount = 0;
    await requestPluginReload(createReloadContext(), () => ({
      async getAddonByID() {
        return {
          async reload() {
            retryCount += 1;
          },
        };
      },
    }));
    assert.equal(retryCount, 1);
  });

  it("fails before storing navigation context when the add-on is not reloadable", async function () {
    await assertRejects(
      requestPluginReload(createReloadContext(), () => ({
        async getAddonByID() {
          return {};
        },
      })),
      "cannot reload Zopilot",
    );

    const lifecycle = (
      globalThis as typeof globalThis & {
        Zotero: Record<string, Record<string, unknown>>;
      }
    ).Zotero[LIFECYCLE_STATE_KEY];
    assert.isUndefined(lifecycle.reloadContext);
  });
});

function createReloadContext(): SidebarReloadContext {
  return {
    workspaceKey: "library:1",
    conversationId: "conversation-a",
    hostContextKind: "library",
  };
}

async function assertRejects(
  promise: Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await promise;
    assert.fail("Expected promise to reject");
  } catch (error) {
    assert.include(
      error instanceof Error ? error.message : String(error),
      expectedMessage,
    );
  }
}
