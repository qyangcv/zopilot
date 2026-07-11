import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { DependenciesPanel } from "../../../src/features/preferences/ui/dependencies/DependenciesPanel.tsx";
import { PreferencesApp } from "../../../src/features/preferences/ui/PreferencesApp.tsx";
import { PromptPanel } from "../../../src/features/preferences/ui/prompts/PromptPanel.tsx";
import type {
  DependencyState,
  PromptView,
} from "../../../src/features/preferences/ui/types.ts";

describe("PreferencesApp", function () {
  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("renders the React settings shell with provider and prompt sections", function () {
    const html = renderToStaticMarkup(
      <PreferencesApp translate={() => undefined} />,
    );

    assert.include(html, "zp-pref-shell");
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-providers"');
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-dependencies"');
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-prompts"');
    assert.include(html, "lucide-pencil-sparkles");
    assert.include(html, 'data-l10n-id="zopilot-pref-provider-title"');
    assert.include(html, 'data-l10n-id="zopilot-pref-provider-add"');
    assert.include(html, 'data-l10n-id="zopilot-pref-provider-kind"');
    assert.include(html, 'class="zp-single-select" data-variant="form"');
    assert.include(html, "lucide-chevron-down");
    assert.include(html, "OpenRouter");
    assert.include(html, 'value="https://openrouter.ai/api/v1"');
    assert.notInclude(html, "<select");
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
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-new"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-title-label"');
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
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-back-button"');
    assert.notInclude(html, "zp-pref-prompt-edit-title");
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-save"');
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-title-label"');
    assert.include(html, "名称");
    assert.include(html, "内容");
    assert.include(html, "保存");
    assert.include(html, "删除");
    assert.notInclude(html, "保存 Prompt");
    assert.notInclude(html, "删除 Prompt");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-new"');
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
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-installed-version"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-latest-version"',
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
    assert.match(
      html,
      /<button(?=[^>]*disabled="")[^>]*>[\s\S]*?data-l10n-id="zopilot-pref-dependencies-update"/,
    );
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-dependencies-install"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-copy"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-reveal"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-open-url"');
  });

  it("renders install instead of update when no helper directory exists", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={{
          status: "ready",
          helper: {
            ...TEST_DEPENDENCY_STATE.helper,
            status: "not-installed",
            installedVersion: undefined,
            installedVersionState: undefined,
            hasInstallCandidate: false,
            needsUpdate: false,
            installCandidateDirs: [],
          },
        }}
      />,
    );

    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-install"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
  });

  it("keeps update enabled when an installed helper needs update", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={{
          status: "ready",
          helper: {
            ...TEST_DEPENDENCY_STATE.helper,
            status: "outdated",
            installedVersion: "0.1.0",
            installedVersionState: "outdated",
            needsUpdate: true,
          },
        }}
      />,
    );

    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
    assert.notMatch(
      html,
      /<button(?=[^>]*disabled="")[^>]*>[\s\S]*?data-l10n-id="zopilot-pref-dependencies-update"/,
    );
  });

  it("renders unsupported dependency status with the reported reason", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={{
          status: "ready",
          helper: {
            status: "unsupported",
            version: "0.2.0",
            latestVersion: "0.2.0",
            hasInstallCandidate: false,
            needsUpdate: false,
            installCandidateDirs: [],
            installDir:
              "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper",
            executablePath: "",
            manifestUrl:
              "https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v0.2.0/pdf-helper-manifest.json",
            reason:
              "Zopilot PDF helper supports macOS arm64, macOS x64, and Windows x64.",
          },
        }}
      />,
    );

    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-status-unsupported"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-unsupported-reason"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-platform-unsupported"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-unsupported-platform-reason"',
    );
    assert.notInclude(html, "macOS arm64");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
  });

  it("marks a latest helper directory without a ready executable as incomplete", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={{
          status: "ready",
          helper: {
            ...TEST_DEPENDENCY_STATE.helper,
            status: "outdated",
            installedVersion: "0.2.0",
            installedVersionState: "incomplete",
            needsUpdate: true,
          },
        }}
      />,
    );

    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-version-incomplete"',
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
  });

  it("hides the title-row installing status while showing progress", function () {
    const html = renderToStaticMarkup(
      <DependenciesPanel
        onCheck={() => undefined}
        onInstall={() => undefined}
        onRemove={() => undefined}
        state={{
          status: "installing",
          helper: TEST_DEPENDENCY_STATE.helper,
          progress: {
            phase: "download",
            percent: 15,
            loaded: 9.2 * 1024 * 1024,
            total: 54 * 1024 * 1024,
          },
        }}
      />,
    );

    assert.notInclude(
      html,
      'data-l10n-id="zopilot-pref-dependencies-status-installing"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-progress-download"',
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-install"');
    assert.include(html, "lucide-loader-circle");
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
    platform: "windows-x64",
    version: "0.2.0",
    latestVersion: "0.2.0",
    installedVersion: "0.2.0",
    installedVersionState: "current",
    hasInstallCandidate: true,
    needsUpdate: false,
    installCandidateDirs: [
      "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper/zopilot-pdf-helper-windows-x64-v0.2.0",
    ],
    installDir:
      "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper",
    executablePath:
      "/Users/yang/Library/Application Support/Zotero/Profiles/example/zopilot/runtime/pdf-helper/zopilot-pdf-helper.exe",
    manifestUrl:
      "https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v0.2.0/pdf-helper-manifest.json",
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
