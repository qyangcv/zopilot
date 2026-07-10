import { assert } from "chai";
import { initPreferencesPane } from "../../../src/features/preferences/mountPreferencesApp.ts";

describe("preferences pane script", function () {
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
