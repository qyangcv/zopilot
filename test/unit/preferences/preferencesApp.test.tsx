import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { DependenciesPanel } from "../../../src/modules/preferences/app/DependenciesPanel.tsx";
import { PreferencesApp } from "../../../src/modules/preferences/app/PreferencesApp.tsx";
import { PromptPanel } from "../../../src/modules/preferences/app/PromptPanel.tsx";
import type {
  DependencyState,
  PromptView,
} from "../../../src/modules/preferences/app/types.ts";

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

  it("renders prompt list mode without the editor form", function () {
    const html = renderToStaticMarkup(
      <PromptPanel
        body=""
        mode="list"
        onBack={() => undefined}
        onBodyChange={() => undefined}
        onDelete={() => undefined}
        onNew={() => undefined}
        onSave={() => undefined}
        onSelect={() => undefined}
        onTitleChange={() => undefined}
        prompts={TEST_PROMPTS}
        title=""
      />,
    );

    assert.include(html, "zp-pref-prompt-list-panel");
    assert.include(html, "Prompt A");
    assert.include(html, 'data-l10n-id="pref-prompt-new"');
    assert.notInclude(html, 'data-l10n-id="pref-prompt-title-label"');
    assert.notInclude(html, "zp-pref-editor-card");
  });

  it("renders prompt edit mode with back and save actions", function () {
    const html = renderToStaticMarkup(
      <PromptPanel
        body="Summarize the selected paper."
        mode="edit"
        onBack={() => undefined}
        onBodyChange={() => undefined}
        onDelete={() => undefined}
        onNew={() => undefined}
        onSave={() => undefined}
        onSelect={() => undefined}
        onTitleChange={() => undefined}
        prompts={TEST_PROMPTS}
        selectedPromptId="custom-a"
        title="Prompt A"
      />,
    );

    assert.include(html, "zp-pref-prompt-edit-page");
    assert.include(html, 'aria-label="返回 Prompt 列表"');
    assert.notInclude(html, "zp-pref-prompt-edit-title");
    assert.include(html, 'data-l10n-id="pref-prompt-save"');
    assert.include(html, 'data-l10n-id="pref-prompt-title-label"');
    assert.include(html, "名称");
    assert.include(html, "内容");
    assert.include(html, "保存");
    assert.include(html, "删除");
    assert.notInclude(html, "保存 Prompt");
    assert.notInclude(html, "删除 Prompt");
    assert.notInclude(html, 'data-l10n-id="pref-prompt-new"');
  });

  it("renders dependency paths with copy and open actions", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={TEST_DEPENDENCY_STATE}
      />,
    );

    assert.include(html, "/Users/yang/Library/Application Support/Zotero");
    assert.include(html, "https://github.com/qyangcv/zopilot/releases");
    assert.include(html, 'data-l10n-id="pref-dependencies-copy"');
    assert.include(html, 'data-l10n-id="pref-dependencies-reveal"');
    assert.include(html, 'data-l10n-id="pref-dependencies-open-url"');
  });
});

const TEST_PROMPTS: PromptView[] = [
  {
    id: "custom-a",
    title: "Prompt A",
    body: "Summarize the selected paper.",
    scope: "global",
    updatedAt: "2026-07-03T00:00:00.000Z",
    custom: true,
  },
];

const TEST_DEPENDENCY_STATE: DependencyState = {
  status: "ready",
  helper: {
    status: "installed",
    platform: "macos-arm64",
    version: "0.1.0",
    installDir:
      "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper",
    executablePath:
      "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper/zopilot-pdf-helper",
    manifestUrl:
      "https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v0.1.0/pdf-helper-manifest.json",
  },
};

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
