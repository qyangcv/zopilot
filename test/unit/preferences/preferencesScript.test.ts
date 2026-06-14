import { assert } from "chai";
import { readFileSync } from "node:fs";
import vm from "node:vm";

describe("preferences.js", function () {
  it("waits for the preference pane markup before initializing", function () {
    const script = readFileSync("addon/content/preferences.js", "utf8");
    const timers: Array<() => void> = [];
    let statusElement: StatusElement | null = null;
    let l10nId = "";

    const context = vm.createContext({
      ChromeUtils: {
        importESModule() {
          throw new Error("Subprocess should not be loaded before IO checks");
        },
      },
      IOUtils: {
        exists: async () => false,
      },
      clearTimeout: () => undefined,
      document: {
        getElementById(id: string) {
          return id === "zopilot-codex-status-value" ? statusElement : null;
        },
        l10n: {
          setAttributes(_element: StatusElement, id: string) {
            l10nId = id;
          },
          translateElements: async () => undefined,
        },
      },
      setTimeout(callback: () => void) {
        timers.push(callback);
        return timers.length;
      },
    });

    assert.doesNotThrow(() => vm.runInContext(script, context));
    assert.lengthOf(timers, 1);

    assert.doesNotThrow(() => timers.shift()?.());
    assert.lengthOf(timers, 1);

    statusElement = { dataset: {}, textContent: "stale" };

    assert.doesNotThrow(() => timers.shift()?.());
    assert.equal(statusElement.dataset.status, "missing");
    assert.equal(statusElement.textContent, "");
    assert.equal(l10nId, "__addonRef__-pref-codex-status-missing");
  });
});

type StatusElement = {
  dataset: Record<string, string>;
  textContent: string;
};
