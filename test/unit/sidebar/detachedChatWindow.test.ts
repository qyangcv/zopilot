import { assert } from "chai";
import {
  DETACHED_CHAT_WINDOW_URI,
  DetachedChatWindow,
  type DetachedChatWindowOptions,
} from "../../../src/features/sidebar/host/DetachedChatWindow.ts";
import type { ZopilotDeckHost } from "../../../src/features/sidebar/host/deckHost.tsx";
import type {
  SidebarActions,
  SidebarState,
  SidebarStreamingSnapshot,
} from "../../../src/features/sidebar/ui/types.ts";

describe("DetachedChatWindow", function () {
  it("opens the plugin-owned chrome document", function () {
    assert.equal(
      DETACHED_CHAT_WINDOW_URI,
      "chrome://zopilot/content/detached-chat-window.xhtml",
    );
  });

  it("opens one window, reuses the shared state, and focuses the singleton", async function () {
    const fixture = createFixture();
    const detached = new DetachedChatWindow({} as Window, fixture.options);
    const state = { title: "Paper" } as SidebarState;
    const actions = { openInWindow: () => undefined } as SidebarActions;
    const snapshot = {
      conversationId: "conversation",
    } as SidebarStreamingSnapshot;

    detached.render(state, actions);
    detached.publishStreaming(snapshot);
    detached.open();
    await settle();

    assert.isTrue(detached.isOpen());
    assert.equal(fixture.openCount, 1);
    assert.equal(fixture.createHostCount, 1);
    assert.strictEqual(fixture.renderedState, state);
    assert.strictEqual(fixture.renderedActions, actions);
    assert.strictEqual(fixture.streamingSnapshot, snapshot);

    detached.open();

    assert.equal(fixture.openCount, 1);
    assert.equal(fixture.focusCount, 2);
  });

  it("waits for the plugin-owned document before mounting", async function () {
    const fixture = createFixture("loading");
    const detached = new DetachedChatWindow({} as Window, fixture.options);

    detached.open();
    assert.equal(fixture.createHostCount, 0);

    fixture.document.readyState = "complete";
    fixture.window.emit("load");
    await settle();

    assert.equal(fixture.createHostCount, 1);
  });

  it("mounts when navigation completes without a load callback", async function () {
    const fixture = createFixture("loading");
    const detached = new DetachedChatWindow({} as Window, fixture.options);

    detached.open();
    fixture.document.readyState = "complete";
    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.equal(fixture.createHostCount, 1);
    detached.destroy();
  });

  it("does not treat the initial document navigation as a window close", async function () {
    const fixture = createFixture("loading");
    const detached = new DetachedChatWindow({} as Window, fixture.options);

    detached.open();
    fixture.window.emit("unload");
    fixture.document.readyState = "complete";
    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.isTrue(detached.isOpen());
    assert.equal(fixture.createHostCount, 1);
    detached.destroy();
  });

  it("reports readiness and a later user close exactly once", async function () {
    const fixture = createFixture();
    let readyCount = 0;
    let closeNotificationCount = 0;
    fixture.options.onReady = () => readyCount++;
    fixture.options.onClose = () => closeNotificationCount++;
    const detached = new DetachedChatWindow({} as Window, fixture.options);

    detached.open();
    await settle();
    fixture.window.close();

    assert.equal(readyCount, 1);
    assert.equal(closeNotificationCount, 1);
  });

  it("destroys the React host and closes the window symmetrically", async function () {
    const fixture = createFixture();
    const detached = new DetachedChatWindow({} as Window, fixture.options);
    detached.open();
    await settle();

    detached.destroy();

    assert.isFalse(detached.isOpen());
    assert.equal(fixture.closeCount, 1);
    assert.equal(fixture.destroyHostCount, 1);

    detached.open();
    assert.equal(fixture.openCount, 1);
  });
});

type FakeWindow = Window & {
  emit: (type: string) => void;
};

function createFixture(readyState: DocumentReadyState = "complete") {
  const listeners = new Map<string, Set<EventListener>>();
  let openCount = 0;
  let focusCount = 0;
  let closeCount = 0;
  let createHostCount = 0;
  let destroyHostCount = 0;
  let renderedState: SidebarState | undefined;
  let renderedActions: SidebarActions | undefined;
  let streamingSnapshot: SidebarStreamingSnapshot | undefined;
  const documentElement = {
    contains: () => false,
    isConnected: true,
  } as unknown as HTMLElement;
  const document = {
    activeElement: null,
    readyState,
    documentElement,
    getElementById: () => (document.readyState === "loading" ? null : panel),
  } as unknown as Document;
  Object.defineProperty(documentElement, "ownerDocument", {
    value: document,
  });
  const panel = {
    isConnected: true,
    ownerDocument: document,
  } as Element;
  const window = {
    closed: false,
    document,
    addEventListener(type: string, listener: EventListener) {
      const bucket = listeners.get(type) || new Set<EventListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    focus() {
      focusCount++;
    },
    close() {
      if (this.closed) return;
      this.closed = true;
      closeCount++;
      this.emit("unload");
    },
    emit(type: string) {
      listeners
        .get(type)
        ?.forEach((listener) => listener.call(this, { type } as Event));
      listeners.delete(type);
    },
  } as unknown as FakeWindow;
  const host = {
    attach: () => false,
    isAttachedTo: () => true,
    render(state, actions) {
      renderedState = state;
      renderedActions = actions;
    },
    publishStreaming(snapshot) {
      streamingSnapshot = snapshot;
    },
    focus: () => undefined,
    destroy() {
      destroyHostCount++;
    },
  } satisfies ZopilotDeckHost;
  const options: DetachedChatWindowOptions = {
    openWindow: () => {
      openCount++;
      return window;
    },
    createHost: async () => {
      createHostCount++;
      return host;
    },
  };
  return {
    options,
    window,
    document,
    get openCount() {
      return openCount;
    },
    get focusCount() {
      return focusCount;
    },
    get closeCount() {
      return closeCount;
    },
    get createHostCount() {
      return createHostCount;
    },
    get destroyHostCount() {
      return destroyHostCount;
    },
    get renderedState() {
      return renderedState;
    },
    get renderedActions() {
      return renderedActions;
    },
    get streamingSnapshot() {
      return streamingSnapshot;
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
