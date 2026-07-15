import { assert } from "chai";
import {
  createPreferenceMountTargets,
  initPreferencesPane,
} from "../../../src/features/preferences/mountPreferencesApp.ts";

describe("preferences pane script", function () {
  it("creates a dedicated portal root instead of relying on document.body", function () {
    const children: unknown[] = [];
    const ownerDocument = {
      createElement() {
        return { className: "" };
      },
    };
    const root = {
      ownerDocument,
      replaceChildren(...items: unknown[]) {
        children.push(...items);
      },
    } as unknown as HTMLElement;

    const targets = createPreferenceMountTargets(root);

    assert.equal(targets.mountNode.className, "zp-pref-react-root");
    assert.equal(targets.portalRoot.className, "zp-pref-portal-root");
    assert.deepEqual(children, [targets.mountNode, targets.portalRoot]);
  });

  it("waits for the React root before rendering", function () {
    const timers: Array<() => void> = [];
    let rootElement: RootElement | null = null;
    let rendered = false;

    initPreferencesPane({
      document: createDocument(() => rootElement),
      schedule: createQueuedScheduler(timers),
      renderApp() {
        rendered = true;
      },
    });

    assert.lengthOf(timers, 1);
    timers.shift()?.();
    assert.isFalse(rendered);
    assert.lengthOf(timers, 1);

    rootElement = createRootElement();
    timers.shift()?.();

    assert.isTrue(rendered);
  });

  it("passes a translation callback to the React app renderer", function () {
    const timers: Array<() => void> = [];
    const rootElement = createRootElement();
    const translated: Element[] = [];
    let translate: (() => void) | undefined;

    initPreferencesPane({
      document: createDocument(() => rootElement, translated),
      schedule: createQueuedScheduler(timers),
      renderApp(_root, props) {
        translate = props.translate;
      },
    });

    timers.shift()?.();
    translate?.();

    assert.include(translated, rootElement);
    assert.includeMembers(translated, rootElement.localizedChildren);
  });

  it("cancels pending initialization and destroys the renderer on pagehide", function () {
    const timers: Array<() => void> = [];
    const pageListeners = new Map<string, EventListener>();
    let destroyCount = 0;
    let renderCount = 0;
    const renderApp = Object.assign(
      () => {
        renderCount++;
      },
      { destroy: () => destroyCount++ },
    );
    const document = {
      ...createDocument(() => createRootElement()),
      defaultView: {
        addEventListener(type: string, listener: EventListener) {
          pageListeners.set(type, listener);
        },
        removeEventListener(type: string) {
          pageListeners.delete(type);
        },
      },
    };

    initPreferencesPane({
      document,
      schedule: createQueuedScheduler(timers),
      cancelSchedule: () => timers.splice(0),
      renderApp,
    });
    timers.shift()?.();
    assert.equal(renderCount, 1);

    pageListeners.get("pagehide")?.({} as Event);

    assert.equal(destroyCount, 1);
    assert.lengthOf(timers, 0);
  });
});

type RootElement = HTMLElement & {
  localizedChildren: Element[];
};

function createQueuedScheduler(timers: Array<() => void>) {
  return (callback: () => void) => {
    timers.push(() => callback());
    return timers.length as unknown as ReturnType<typeof setTimeout>;
  };
}

function createDocument(
  getRoot: () => RootElement | null,
  translated: Element[] = [],
) {
  return {
    getElementById(id: string) {
      return id === "zopilot-preferences-root" ? getRoot() : null;
    },
    l10n: {
      translateElements: async (elements: Element[]) => {
        translated.push(...elements);
      },
    },
  };
}

function createRootElement(): RootElement {
  const localizedChildren = [{} as Element, {} as Element];
  return {
    localizedChildren,
    querySelectorAll(selector: string) {
      return selector === "[data-l10n-id]" ? localizedChildren : [];
    },
  } as unknown as RootElement;
}
