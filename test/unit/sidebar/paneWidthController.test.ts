import { assert } from "chai";
import {
  PaneWidthController,
  type PaneWidthState,
  type PaneWidthTarget,
} from "../../../src/features/sidebar/host/PaneWidthController.ts";

describe("PaneWidthController", function () {
  it("maximizes to the native constraint and restores the exact prior width", function () {
    const fixture = createFixture();
    let state: PaneWidthState = {
      canMaximize: false,
      maximized: false,
    };
    const controller = new PaneWidthController(fixture.win, {
      onStateChange: (next) => (state = next),
    });

    controller.reconcile(fixture.target);
    assert.deepEqual(state, { canMaximize: true, maximized: false });

    controller.toggle();
    assert.deepEqual(state, { canMaximize: true, maximized: true });
    assert.equal(fixture.pane.getAttribute("width"), "820");
    assert.equal(fixture.pane.style.getPropertyValue("width"), "820px");

    fixture.pane.width = 820;
    fixture.sibling.width = 740;
    controller.reconcile(fixture.target);
    assert.equal(fixture.pane.getAttribute("width"), "1190");

    controller.toggle();
    assert.deepEqual(state, { canMaximize: true, maximized: false });
    assert.equal(fixture.pane.getAttribute("width"), "420");
    assert.equal(fixture.pane.style.getPropertyValue("width"), "420px");
    assert.isAtLeast(fixture.resizeEvents, 3);
  });

  it("does not expose maximize for stacked or invalid geometry", function () {
    const fixture = createFixture();
    const states: PaneWidthState[] = [];
    const controller = new PaneWidthController(fixture.win, {
      onStateChange: (state) => states.push(state),
    });

    controller.reconcile({ ...fixture.target, standard: false });
    assert.deepEqual(controller.getState(), {
      canMaximize: false,
      maximized: false,
    });

    fixture.sibling.minWidth = "auto";
    controller.reconcile(fixture.target);
    assert.deepEqual(controller.getState(), {
      canMaximize: false,
      maximized: false,
    });
    assert.deepEqual(states, []);
  });

  it("does not overwrite width fields changed by the Zotero host", function () {
    const fixture = createFixture();
    const controller = new PaneWidthController(fixture.win, {
      onStateChange: () => undefined,
    });
    controller.reconcile(fixture.target);
    controller.toggle();

    fixture.pane.setAttribute("width", "600");
    fixture.pane.style.setProperty("width", "610px");
    controller.toggle();

    assert.equal(fixture.pane.getAttribute("width"), "600");
    assert.equal(fixture.pane.style.getPropertyValue("width"), "610px");
  });

  it("releases ownership without restoring when the native splitter is dragged", function () {
    const fixture = createFixture();
    let state: PaneWidthState | undefined;
    const controller = new PaneWidthController(fixture.win, {
      onStateChange: (next) => (state = next),
    });
    controller.reconcile(fixture.target);
    controller.toggle();
    fixture.pane.setAttribute("width", "700");
    fixture.pane.style.setProperty("width", "700px");

    fixture.splitter.setAttribute("state", "dragging");
    fixture.splitter.emit("mousemove");

    assert.deepEqual(state, { canMaximize: true, maximized: false });
    assert.equal(fixture.pane.getAttribute("width"), "700");
    assert.equal(fixture.pane.style.getPropertyValue("width"), "700px");
  });

  it("restores the old pane before adopting a different surface", function () {
    const fixture = createFixture();
    const controller = new PaneWidthController(fixture.win, {
      onStateChange: () => undefined,
    });
    controller.reconcile(fixture.target);
    controller.toggle();

    const nextPane = fixture.element(360, "360px");
    nextPane.setAttribute("width", "360");
    const nextSibling = fixture.element(720);
    nextSibling.minWidth = "370px";
    const nextSplitter = fixture.element(3);
    controller.reconcile({
      pane: nextPane,
      sibling: nextSibling,
      splitter: nextSplitter,
      standard: true,
    });

    assert.equal(fixture.pane.getAttribute("width"), "420");
    assert.equal(nextPane.getAttribute("width"), "360");
    assert.deepEqual(controller.getState(), {
      canMaximize: true,
      maximized: false,
    });
  });
});

type FakeElement = Element & {
  width: number;
  minWidth: string;
  emit: (type: string) => void;
  style: CSSStyleDeclaration;
};

function createFixture() {
  const doc = {} as Document;
  let resizeEvents = 0;
  const win = {
    document: doc,
    Event: class {
      constructor(readonly type: string) {}
    },
    dispatchEvent(event: Event) {
      if (event.type === "resize") resizeEvents++;
      return true;
    },
    getComputedStyle(element: FakeElement) {
      return { minWidth: element.minWidth };
    },
  } as unknown as Window;
  const element = (width: number, styleWidth = "") =>
    createElement(doc, width, styleWidth);
  const pane = element(420, "420px");
  pane.setAttribute("width", "420");
  const sibling = element(770);
  sibling.minWidth = "370px";
  const splitter = element(3);
  const target: PaneWidthTarget = {
    pane,
    sibling,
    splitter,
    standard: true,
  };
  return {
    win,
    pane,
    sibling,
    splitter,
    target,
    element,
    get resizeEvents() {
      return resizeEvents;
    },
  };
}

function createElement(
  ownerDocument: Document,
  width: number,
  styleWidth: string,
): FakeElement {
  const attributes = new Map<string, string>();
  const values = new Map<string, string>();
  const priorities = new Map<string, string>();
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  if (styleWidth) values.set("width", styleWidth);
  const style = {
    getPropertyValue: (name: string) => values.get(name) || "",
    getPropertyPriority: (name: string) => priorities.get(name) || "",
    setProperty: (name: string, value: string, priority = "") => {
      values.set(name, value);
      priorities.set(name, priority);
    },
    removeProperty: (name: string) => {
      const previous = values.get(name) || "";
      values.delete(name);
      priorities.delete(name);
      return previous;
    },
  } as CSSStyleDeclaration;
  const element = {
    ownerDocument,
    isConnected: true,
    width,
    minWidth: "0px",
    style,
    getBoundingClientRect() {
      return { width: this.width };
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) {
      listeners.get(type)?.delete(listener);
    },
    emit(type: string) {
      for (const listener of listeners.get(type) || []) {
        if (typeof listener === "function") {
          listener({ type } as Event);
        } else {
          listener.handleEvent({ type } as Event);
        }
      }
    },
  } as unknown as FakeElement;
  return element;
}
