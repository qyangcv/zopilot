import { assert } from "chai";
import { SidebarHostBindings } from "../../../src/features/sidebar/host/SidebarHostBindings.ts";

describe("sidebar host bindings", function () {
  it("captures interactions from dynamically rendered Zotero trees", function () {
    const doc = new FakeDocument();
    const collectionsTree = new FakeElement();
    const itemsTree = new FakeElement();
    doc.elements.set("zotero-collections-tree", collectionsTree);
    doc.elements.set("zotero-items-tree", itemsTree);
    const raf = createRafWindow();
    let syncCount = 0;
    const bindings = new SidebarHostBindings({
      doc: doc as unknown as Document,
      win: raf.win,
      ensureMountedSurfaces: () => undefined,
      refreshContext: () => undefined,
      syncWithSelectedContext: () => syncCount++,
      isOpen: () => true,
      isDestroyed: () => false,
      getDeckPanel: () => undefined,
      getHostMutationTargets: () => ({ attributes: [], childList: [] }),
      subscribePrompts: () => () => undefined,
      updatePrompts: () => undefined,
      subscribeProviders: () => () => undefined,
    });
    const disposers = (
      bindings as unknown as {
        bindContextRefresh(): Array<() => void>;
      }
    ).bindContextRefresh();

    collectionsTree.dispatch("mousedown");
    raf.flush();
    itemsTree.dispatch("keyup");
    raf.flush();
    // Zotero replaces a newly selected virtual-tree row between mousedown and
    // mouseup, so the first interaction may never produce a click event.
    assert.equal(syncCount, 2);
    assert.isTrue(collectionsTree.allListenersUseCapture());
    assert.isTrue(itemsTree.allListenersUseCapture());

    disposers.forEach((dispose) => dispose());
    collectionsTree.dispatch("mousedown");
    assert.equal(syncCount, 2);
  });

  it("synchronizes context from Zotero tab notifications", function () {
    const doc = new FakeDocument() as FakeDocument & {
      documentElement: Element;
    };
    doc.documentElement = {} as Element;
    let syncCount = 0;
    const raf = createRafWindow();
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
        ...raf.win,
        MutationObserver: class {
          observe() {}
          disconnect() {}
        },
        addEventListener() {},
        removeEventListener() {},
      } as unknown as Window,
      ensureMountedSurfaces: () => undefined,
      refreshContext: () => undefined,
      syncWithSelectedContext: () => syncCount++,
      isOpen: () => true,
      isDestroyed: () => false,
      getDeckPanel: () => undefined,
      getHostMutationTargets: () => ({ attributes: [], childList: [] }),
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
    raf.flush();
    tabObserver?.notify("load" as never, "tab", ["reader-a"], {});
    raf.flush();
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
  readonly elements = new Map<string, FakeElement>();
  private readonly listeners = new Map<string, ListenerRecord[]>();

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) || null;
  }

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

function createRafWindow(): {
  win: Window;
  flush(): void;
} {
  let nextID = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    win: {
      requestAnimationFrame(callback) {
        const id = ++nextID;
        callbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        callbacks.delete(id);
      },
    } as Window,
    flush() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(0));
    },
  };
}

class FakeElement {
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

  dispatch(type: string): void {
    (this.listeners.get(type) || []).forEach((record) =>
      record.listener({ target: this } as unknown as Event),
    );
  }

  allListenersUseCapture(): boolean {
    return [...this.listeners.values()].flat().every((item) => item.capture);
  }
}
