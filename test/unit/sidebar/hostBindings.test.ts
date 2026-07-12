import { assert } from "chai";
import { SidebarHostBindings } from "../../../src/features/sidebar/host/SidebarHostBindings.ts";

describe("sidebar host bindings", function () {
  it("captures interactions from dynamically rendered Zotero trees", function () {
    const doc = new FakeDocument();
    let syncCount = 0;
    const bindings = new SidebarHostBindings({
      doc: doc as unknown as Document,
      win: {
        setTimeout(callback: TimerHandler) {
          if (typeof callback === "function") callback();
          return 1;
        },
      } as unknown as Window,
      ensureMountedSurfaces: () => undefined,
      refreshContext: () => undefined,
      syncWithSelectedContext: () => syncCount++,
      isOpen: () => true,
      isDestroyed: () => false,
      areSessionsOpen: () => false,
      getDeckPanel: () => undefined,
      hideSessions: () => undefined,
      subscribePrompts: () => () => undefined,
      updatePrompts: () => undefined,
      subscribeProviders: () => () => undefined,
    });
    const disposers = (
      bindings as unknown as {
        bindContextRefresh(): Array<() => void>;
      }
    ).bindContextRefresh();

    doc.dispatch("mousedown", createTreeTarget(true));
    doc.dispatch("keyup", createTreeTarget(true));
    // Zotero replaces a newly selected virtual-tree row between mousedown and
    // mouseup, so the first interaction may never produce a click event.
    doc.dispatch("click", createTreeTarget(true));
    doc.dispatch("click", createTreeTarget(false));

    assert.equal(syncCount, 2);
    assert.isTrue(doc.allListenersUseCapture());

    disposers.forEach((dispose) => dispose());
    doc.dispatch("mousedown", createTreeTarget(true));
    assert.equal(syncCount, 2);
  });

  it("synchronizes context from Zotero tab notifications", function () {
    const doc = new FakeDocument() as FakeDocument & {
      documentElement: Element;
    };
    doc.documentElement = {} as Element;
    let syncCount = 0;
    let tabObserver: { notify: _ZoteroTypes.Notifier.Notify } | undefined;
    let unregisteredID = "";
    (globalThis as unknown as { Zotero: Record<string, any> }).Zotero = {
      Notifier: {
        registerObserver(observer: { notify: _ZoteroTypes.Notifier.Notify }) {
          tabObserver = observer;
          return "tab-observer";
        },
        unregisterObserver(id: string) {
          unregisteredID = id;
        },
      },
    };
    const bindings = new SidebarHostBindings({
      doc: doc as unknown as Document,
      win: {
        MutationObserver: class {
          observe() {}
          disconnect() {}
        },
        addEventListener() {},
        removeEventListener() {},
        setTimeout(callback: TimerHandler) {
          if (typeof callback === "function") callback();
          return 1;
        },
      } as unknown as Window,
      ensureMountedSurfaces: () => undefined,
      refreshContext: () => undefined,
      syncWithSelectedContext: () => syncCount++,
      isOpen: () => true,
      isDestroyed: () => false,
      areSessionsOpen: () => false,
      getDeckPanel: () => undefined,
      hideSessions: () => undefined,
      subscribePrompts: () => () => undefined,
      updatePrompts: () => undefined,
      subscribeProviders: () => () => undefined,
    });
    const disposers = (
      bindings as unknown as {
        bindLayoutRefresh(): Array<() => void>;
      }
    ).bindLayoutRefresh();

    tabObserver?.notify("select", "tab", ["reader-a"], {});
    tabObserver?.notify("load" as never, "tab", ["reader-a"], {});
    tabObserver?.notify("select", "item", [1], {});

    assert.equal(syncCount, 2);
    disposers.forEach((dispose) => dispose());
    assert.equal(unregisteredID, "tab-observer");
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });
});

type ListenerRecord = {
  listener: EventListener;
  capture: boolean;
};

class FakeDocument {
  private readonly listeners = new Map<string, ListenerRecord[]>();

  addEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const records = this.listeners.get(type) || [];
    records.push({
      listener,
      capture:
        typeof options === "boolean" ? options : Boolean(options?.capture),
    });
    this.listeners.set(type, records);
  }

  removeEventListener(
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture =
      typeof options === "boolean" ? options : Boolean(options?.capture);
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(
        (record) => record.listener !== listener || record.capture !== capture,
      ),
    );
  }

  dispatch(type: string, target: Element): void {
    for (const record of this.listeners.get(type) || []) {
      record.listener({ target } as unknown as Event);
    }
  }

  allListenersUseCapture(): boolean {
    return [...this.listeners.values()]
      .flat()
      .every((record) => record.capture);
  }
}

function createTreeTarget(insideTree: boolean): Element {
  return {
    closest: () => (insideTree ? ({} as Element) : null),
  } as unknown as Element;
}
