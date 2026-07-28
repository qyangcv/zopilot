import { assert } from "chai";
import { SidebarSurface } from "../../../src/features/sidebar/host/SidebarSurface.ts";
import { ContextPaneDeckAdapter } from "../../../src/features/sidebar/host/ContextPaneAdapter.ts";
import { LibraryItemPaneAdapter } from "../../../src/features/sidebar/host/LibraryItemPaneAdapter.ts";

describe("sidebar surface", function () {
  it("recognizes a connected XUL panel without HTMLElement identity", function () {
    const doc = {} as Document;
    const adapter = new ContextPaneDeckAdapter({ document: doc } as Window);
    const xulPanel = {
      isConnected: true,
      ownerDocument: doc,
    } as Element;
    (adapter as unknown as { panel: Element }).panel = xulPanel;

    assert.strictEqual(adapter.getPanel(), xulPanel);
  });

  it("collapses the Zotero Reader context pane through its host controller", function () {
    const contextPane = { collapsed: false };
    const adapter = new ContextPaneDeckAdapter({
      document: {},
      ZoteroContextPane: contextPane,
    } as unknown as Window);

    assert.isTrue(adapter.collapse());
    assert.isTrue(contextPane.collapsed);
  });

  it("reads the collapsed state from the Zotero library item pane", function () {
    const itemPane = {
      collapsed: true,
      getAttribute: () => null,
    };
    const deck = { selectedIndex: 0 };
    const sidenav = {};
    const doc = {
      querySelector: (selector: string) =>
        selector === "#zotero-item-pane"
          ? itemPane
          : selector === "#zotero-item-pane-content"
            ? deck
            : selector === "#zotero-view-item-sidenav"
              ? sidenav
              : null,
    } as unknown as Document;
    const adapter = new LibraryItemPaneAdapter({ document: doc } as Window);

    assert.isFalse(adapter.isPaneVisible());
    itemPane.collapsed = false;
    assert.isTrue(adapter.isPaneVisible());
  });

  it("does not reopen an intact library pane during context sync", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
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
      getPanel: () => panel,
      isPaneVisible: () => true,
      selectZopilot: () => {
        selectCount++;
        return true;
      },
    };
    internals.deckHost = {
      attach: () => undefined,
      isAttachedTo: () => true,
    };
    internals.activeKind = "library";
    const panel = { isConnected: true };
    internals.deckPanel = panel;

    surface.attachLibrary();

    assert.equal(ensureActiveCount, 1);
    assert.equal(selectCount, 0);
  });

  it("does not reactivate an intact library panel during resize reconciliation", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
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
    internals.libraryAdapter = {
      mount: () => mountCount++,
      getPanel: () => panel,
      isPaneVisible: () => true,
    };
    internals.deckHost = { isAttachedTo: () => true };
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

  it("repairs a connected library panel when the React host is elsewhere", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    let attachCount = 0;
    internals.deckAdapter = { mount: () => undefined };
    internals.libraryAdapter = {
      mount: () => undefined,
      getPanel: () => panel,
      isPaneVisible: () => true,
    };
    internals.deckHost = { isAttachedTo: () => false };
    internals.toolbarCleanup = { refresh: () => undefined };
    internals.activeKind = "library";
    internals.deckPanel = panel;
    internals.attachLibrary = () => attachCount++;

    surface.ensureMounted();

    assert.equal(attachCount, 1);
  });

  it("deactivates the library surface when Zotero collapses its host pane", function () {
    const changes: Array<[string, boolean]> = [];
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: (kind, active) => changes.push([kind, active]),
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    let deactivated = false;
    let attachCount = 0;
    internals.deckAdapter = { mount: () => undefined };
    internals.libraryAdapter = {
      mount: () => undefined,
      isPaneVisible: () => false,
      deactivate: () => {
        deactivated = true;
      },
    };
    internals.activeKind = "library";
    internals.deckPanel = panel;
    internals.attachLibrary = () => attachCount++;

    surface.ensureMounted();

    assert.isTrue(deactivated);
    assert.equal(attachCount, 0);
    assert.isUndefined(internals.activeKind);
    assert.isUndefined(internals.deckPanel);
    assert.deepEqual(changes, [["library", false]]);
  });

  it("reopens a collapsed library pane even when its panel is still connected", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    let ensureActiveCount = 0;
    let selectCount = 0;
    internals.deckAdapter = { deactivate: () => undefined };
    internals.libraryAdapter = {
      deactivate: () => undefined,
      ensureActiveSelection: () => ensureActiveCount++,
      ensurePanel: () => panel,
      getPanel: () => panel,
      isPaneVisible: () => false,
      selectZopilot: () => {
        selectCount++;
        return true;
      },
    };
    internals.activeKind = "library";
    internals.deckPanel = panel;
    internals.activatePanel = () => undefined;

    surface.attachLibrary();

    assert.equal(ensureActiveCount, 0);
    assert.equal(selectCount, 1);
  });

  it("collapses the Reader host when the Zopilot close action is requested", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const calls: string[] = [];
    internals.deckAdapter = {
      collapse: () => {
        calls.push("collapse");
        return true;
      },
      restoreHostState: () => calls.push("restore-host"),
      restoreNativePanel: () => calls.push("restore-panel"),
    };
    internals.libraryAdapter = {
      restoreHostState: () => undefined,
      selectNative: () => true,
    };
    internals.activeKind = "reader";
    internals.deckPanel = {};

    surface.close({
      restoreItemPane: true,
      collapseActiveHost: true,
    });

    assert.deepEqual(calls, ["restore-panel", "restore-host", "collapse"]);
    assert.isUndefined(internals.activeKind);
    assert.isUndefined(internals.deckPanel);
  });

  it("does not collapse the Reader host when a native pane deactivates Zopilot", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    let collapseCount = 0;
    internals.deckAdapter = {
      collapse: () => {
        collapseCount++;
        return true;
      },
    };
    internals.activeKind = "reader";

    surface.close();

    assert.equal(collapseCount, 0);
  });

  it("ignores deactivation from a background surface", function () {
    const changes: Array<[string, boolean]> = [];
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: (kind, active) => changes.push([kind, active]),
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    internals.activeKind = "reader";
    internals.deckPanel = panel;

    internals.requestDeactivation("library");

    assert.equal(internals.activeKind, "reader");
    assert.equal(internals.deckPanel, panel);
    assert.deepEqual(changes, []);
  });

  it("reattaches an existing host even when the target panel identity is unchanged", function () {
    const surface = new SidebarSurface({ document: {} } as unknown as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => undefined,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    let attachedPanel: unknown;
    internals.deckPanel = panel;
    internals.deckHost = {
      attach: (target: unknown) => (attachedPanel = target),
    };

    internals.activatePanel("reader", panel);

    assert.equal(attachedPanel, panel);
  });

  it("does not call onReady when an intact host is already attached", function () {
    let readyCount = 0;
    const surface = new SidebarSurface({ document: {} } as Window, {
      isDestroyed: () => false,
      isOpen: () => true,
      onActiveSurfaceChange: () => undefined,
      onUnavailable: () => undefined,
      onReady: () => readyCount++,
    });
    const internals = surface as unknown as Record<string, any>;
    const panel = { isConnected: true };
    internals.deckHost = {
      attach: () => false,
      isAttachedTo: () => true,
    };

    internals.activatePanel("reader", panel);
    internals.activatePanel("reader", panel);

    assert.equal(readyCount, 0);
  });
});
