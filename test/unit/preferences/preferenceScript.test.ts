import { assert } from "chai";
import { registerPreferencePane } from "../../../src/features/preferences/registerPreferencePane.ts";

describe("preference pane registration", function () {
  let previousAddon: unknown;
  let previousRootURI: unknown;
  let previousZotero: unknown;
  const globals = globalThis as unknown as {
    addon?: unknown;
    rootURI?: unknown;
    Zotero?: unknown;
  };

  beforeEach(function () {
    previousAddon = globals.addon;
    previousRootURI = globals.rootURI;
    previousZotero = globals.Zotero;
  });

  afterEach(function () {
    globals.addon = previousAddon;
    globals.rootURI = previousRootURI;
    globals.Zotero = previousZotero;
  });

  it("uses the shared Zopilot icon for the pane image", function () {
    let registered: Record<string, unknown> | undefined;
    globals.addon = {
      data: {
        config: {
          addonID: "zopilot@example.test",
          addonRef: "zopilot",
        },
      },
    };
    globals.rootURI = "chrome://zopilot/";
    globals.Zotero = {
      PreferencePanes: {
        register(options: Record<string, unknown>) {
          registered = options;
        },
      },
    };

    registerPreferencePane();

    assert.equal(
      registered?.image,
      "chrome://zopilot/content/icons/zopilot.svg",
    );
  });
});
