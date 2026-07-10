import { assert } from "chai";
import { SidebarSurface } from "../../../src/features/sidebar/host/SidebarSurface.ts";

describe("sidebar surface", function () {
  it("does not reopen an intact library pane during context sync", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      pluginID: "zopilot@test",
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, unknown>;
    let ensureActiveCount = 0;
    let selectCount = 0;
    internals.libraryAdapter = {
      ensureActiveSelection: () => ensureActiveCount++,
      selectZopilot: () => {
        selectCount++;
        return true;
      },
    };
    internals.activeKind = "library";
    internals.deckPanel = { isConnected: true };

    surface.attachLibrary();

    assert.equal(ensureActiveCount, 1);
    assert.equal(selectCount, 0);
  });

  it("does not reactivate an intact library panel during resize reconciliation", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      pluginID: "zopilot@test",
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, unknown>;
    let attachCount = 0;
    let mountCount = 0;
    const panel = { isConnected: true };
    internals.deckAdapter = { mount: () => mountCount++ };
    internals.libraryAdapter = { mount: () => mountCount++ };
    internals.toolbarCleanup = { refresh: () => undefined };
    internals.activeKind = "library";
    internals.deckPanel = panel;
    internals.attachLibrary = () => attachCount++;

    surface.ensureMounted();

    assert.equal(mountCount, 2);
    assert.equal(attachCount, 0);

    panel.isConnected = false;
    surface.ensureMounted();
    assert.equal(attachCount, 1);
  });
});
