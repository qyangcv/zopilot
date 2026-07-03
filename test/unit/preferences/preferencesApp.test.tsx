import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesApp } from "../../../src/modules/preferences/app/PreferencesApp.tsx";

describe("PreferencesApp", function () {
  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("renders the React settings shell with connection and prompt sections", function () {
    const html = renderToStaticMarkup(
      <PreferencesApp
        getSubprocess={() => {
          throw new Error("Subprocess unavailable in server render.");
        }}
        translate={() => undefined}
      />,
    );

    assert.include(html, "zp-pref-shell");
    assert.include(html, 'data-l10n-id="pref-nav-connection"');
    assert.include(html, 'data-l10n-id="pref-nav-dependencies"');
    assert.include(html, 'data-l10n-id="pref-nav-prompts"');
    assert.include(html, 'data-l10n-id="pref-codex-card-title"');
    assert.include(html, 'data-l10n-id="pref-codex-check"');
    assert.notInclude(html, "zp-pref-brand");
  });
});

function installZoteroMock(): void {
  (
    globalThis as typeof globalThis & {
      Zotero: {
        Prefs: {
          get: (key: string) => unknown;
          set: (key: string, value: unknown) => void;
        };
      };
    }
  ).Zotero = {
    Prefs: {
      get(key) {
        return key.endsWith("prompts.custom") ? "[]" : undefined;
      },
      set() {
        return undefined;
      },
    },
  };
}
