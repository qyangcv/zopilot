import { assert } from "chai";
import {
  __sidebarControllerTestHooks,
  getInitialSidebarWidth,
  getSidebarCollapseThreshold,
  resolveSidebarResizeWidth,
} from "../../../src/modules/sidebar/controller.ts";

describe("sidebar controller resize", function () {
  before(function () {
    installLocaleMock();
  });

  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("uses the responsive close threshold", function () {
    assert.equal(getSidebarCollapseThreshold(1200), 300);
    assert.equal(getSidebarCollapseThreshold(860), 280);
  });

  it("falls back from stored widths at or below the close threshold", function () {
    assert.equal(getInitialSidebarWidth(300, 1200), 372);
    assert.equal(getInitialSidebarWidth(280, 860), 372);
    assert.equal(getInitialSidebarWidth(650, 1200), 650);
  });

  it("does not clamp resize widths above the old maximum", function () {
    assert.deepEqual(resolveSidebarResizeWidth(650, 1200), {
      action: "resize",
      width: 650,
    });
  });

  it("closes through the shared close path at the wide threshold", function () {
    const harness = createResizeHarness({ viewportWidth: 1200 });
    let closed = false;
    harness.controller.setOpen = (open: boolean) => {
      closed = open === false;
      harness.shell.remove();
    };

    harness.startDrag();
    harness.dispatchPointerMove(672);
    harness.dispatchPointerUp(672);

    assert.isTrue(closed);
    assert.isTrue(harness.shell.removed);
    assert.deepEqual(getPrefWrites(), []);
    assert.isFalse(harness.hasWindowListener("pointermove"));
    assert.isFalse(harness.hasWindowListener("pointerup"));
  });

  it("closes through the shared close path at the compact threshold", function () {
    const harness = createResizeHarness({ viewportWidth: 860 });
    let closed = false;
    harness.controller.setOpen = (open: boolean) => {
      closed = open === false;
      harness.shell.remove();
    };

    harness.startDrag();
    harness.dispatchPointerMove(692);

    assert.isTrue(closed);
    assert.isTrue(harness.shell.removed);
    assert.deepEqual(getPrefWrites(), []);
  });

  it("sets and persists arbitrary widths above the threshold", function () {
    const harness = createResizeHarness({ viewportWidth: 1200 });

    harness.startDrag();
    harness.dispatchPointerMove(322);
    assert.equal(harness.shell.getAttribute("width"), "650");
    assert.equal(harness.shell.style.width, "650px");
    assert.equal(harness.shell.style.flexBasis, "650px");

    harness.dispatchPointerUp(322);

    assert.deepEqual(getPrefWrites(), [
      {
        key: "extensions.zotero.zopilot.sidebar.width",
        value: 650,
        global: true,
      },
    ]);
  });

  it("returns selected sidebar text only when the selection is inside the shell", function () {
    const insideStart = {};
    const insideEnd = {};
    const outside = {};
    const root = {
      contains(node: unknown) {
        return node === insideStart || node === insideEnd;
      },
    };
    const getSidebarSelectionText = (
      __sidebarControllerTestHooks as unknown as {
        getSidebarSelectionText: (win: Window, root?: Node) => string;
      }
    ).getSidebarSelectionText;

    assert.equal(
      getSidebarSelectionText(
        createSelectionWindow({
          anchorNode: insideStart,
          focusNode: insideEnd,
          text: "selected title",
        }),
        root as unknown as Node,
      ),
      "selected title",
    );

    assert.equal(
      getSidebarSelectionText(
        createSelectionWindow({
          anchorNode: insideStart,
          focusNode: outside,
          text: "cross-boundary text",
        }),
        root as unknown as Node,
      ),
      "",
    );
  });
});

type PrefWrite = {
  key: string;
  value: unknown;
  global: boolean;
};

type PointerListener = (event: FakePointerEvent) => void;

type FakePointerEvent = {
  type: string;
  button: number;
  clientX: number;
  pointerId: number;
  currentTarget?: FakeSplitter;
  preventDefault: () => void;
  stopPropagation: () => void;
};

function createResizeHarness(options: { viewportWidth: number }) {
  const win = new FakeWindow(options.viewportWidth);
  const controller = new (
    __sidebarControllerTestHooks as unknown as {
      SidebarController: new (win: Window) => Record<string, unknown>;
    }
  ).SidebarController(win as unknown as Window) as Record<string, any>;
  const shell = new FakeShell(372);
  const splitter = new FakeSplitter();
  controller.shell = shell;
  controller.open = true;

  return {
    controller,
    shell,
    startDrag() {
      controller.startResize(
        createPointerEvent("pointerdown", 600, { currentTarget: splitter }),
      );
    },
    dispatchPointerMove(clientX: number) {
      win.dispatchPointerEvent(createPointerEvent("pointermove", clientX));
    },
    dispatchPointerUp(clientX: number) {
      win.dispatchPointerEvent(createPointerEvent("pointerup", clientX));
    },
    hasWindowListener(type: string) {
      return win.hasListener(type);
    },
  };
}

function createPointerEvent(
  type: string,
  clientX: number,
  patch: Partial<FakePointerEvent> = {},
): FakePointerEvent {
  return {
    type,
    button: 0,
    clientX,
    pointerId: 1,
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    ...patch,
  };
}

function createSelectionWindow(options: {
  anchorNode: unknown;
  focusNode: unknown;
  text: string;
}): Window {
  return {
    getSelection() {
      return {
        anchorNode: options.anchorNode,
        focusNode: options.focusNode,
        isCollapsed: false,
        rangeCount: 1,
        toString() {
          return options.text;
        },
      };
    },
  } as unknown as Window;
}

class FakeWindow {
  readonly document: FakeDocument;
  readonly URL = URL;
  readonly Event = class {
    constructor(readonly type: string) {}
  };
  private readonly listeners = new Map<string, Set<PointerListener>>();

  constructor(readonly innerWidth: number) {
    this.document = new FakeDocument(innerWidth);
  }

  addEventListener(type: string, listener: PointerListener): void {
    const listeners = this.listeners.get(type) || new Set<PointerListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: PointerListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  dispatchPointerEvent(event: FakePointerEvent): void {
    for (const listener of Array.from(this.listeners.get(event.type) || [])) {
      listener(event);
    }
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    callback(0);
    return 1;
  }

  hasListener(type: string): boolean {
    return Boolean(this.listeners.get(type)?.size);
  }
}

class FakeDocument {
  readonly documentElement: { clientWidth: number };

  constructor(clientWidth: number) {
    this.documentElement = { clientWidth };
  }
}

class FakeShell {
  readonly style: Record<string, string> = {};
  removed = false;
  private readonly attributes = new Map<string, string>();

  constructor(width: number) {
    this.setAttribute("width", String(width));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.attributes.has(name);
    if (enabled) {
      this.attributes.set(name, "true");
    } else {
      this.attributes.delete(name);
    }
    return enabled;
  }

  getBoundingClientRect(): { width: number } {
    return { width: Number(this.getAttribute("width")) || 0 };
  }

  remove(): void {
    this.removed = true;
  }
}

class FakeSplitter {
  setPointerCapture(): void {
    return undefined;
  }

  releasePointerCapture(): void {
    return undefined;
  }
}

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                messages: Array<{ id: string }>,
              ) => Array<{ value: string }>;
            };
          };
        };
      };
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}

function installZoteroMock(): void {
  const writes: PrefWrite[] = [];
  (
    globalThis as typeof globalThis & {
      Zotero: {
        rtl: boolean;
        Prefs: {
          get: () => unknown;
          set: (key: string, value: unknown, global: boolean) => void;
        };
      };
      __prefWrites: PrefWrite[];
    }
  ).Zotero = {
    rtl: false,
    Prefs: {
      get: () => undefined,
      set(key, value, global) {
        writes.push({ key, value, global });
      },
    },
  };
  (globalThis as unknown as { __prefWrites: PrefWrite[] }).__prefWrites =
    writes;
}

function getPrefWrites(): PrefWrite[] {
  return (globalThis as unknown as { __prefWrites: PrefWrite[] }).__prefWrites;
}
