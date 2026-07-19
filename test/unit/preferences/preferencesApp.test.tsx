import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderProfile } from "../../../src/domain/agent/types.ts";
import { DependenciesPanel } from "../../../src/features/preferences/ui/dependencies/DependenciesPanel.tsx";
import { PreferenceCodeScroller } from "../../../src/features/preferences/ui/PreferenceCodeScroller.tsx";
import { findNextPreferenceSection } from "../../../src/features/preferences/ui/PreferenceSectionNavigation.tsx";
import { PreferencesApp } from "../../../src/features/preferences/ui/PreferencesApp.tsx";
import {
  ProviderCard,
  createProviderUpdateInput,
} from "../../../src/features/preferences/ui/providers/ProviderCard.tsx";
import {
  AddProviderForm,
  updateSelectedModelIds,
} from "../../../src/features/preferences/ui/providers/AddProviderForm.tsx";
import { toggleProviderExpansion } from "../../../src/features/preferences/ui/providers/ProviderPanel.tsx";
import { PromptPanel } from "../../../src/features/preferences/ui/prompts/PromptPanel.tsx";
import { getPromptModeAfterSave } from "../../../src/features/preferences/ui/prompts/usePromptEditor.ts";
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

  it("renders compact tabs and keeps the add-provider form collapsed", function () {
    const html = renderToStaticMarkup(
      <PreferencesApp translate={() => undefined} />,
    );

    assert.include(html, "zp-pref-shell");
    assert.include(html, 'role="tablist"');
    assert.include(html, 'role="tab"');
    assert.include(html, 'aria-selected="true"');
    assert.include(html, 'role="tabpanel"');
    assert.equal(countOccurrences(html, 'role="tabpanel"'), 3);
    assert.equal(countOccurrences(html, 'hidden=""'), 2);
    assert.include(html, 'id="zp-pref-panel-providers"');
    assert.include(html, 'id="zp-pref-panel-dependencies"');
    assert.include(html, 'id="zp-pref-panel-prompts"');
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-providers"');
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-dependencies"');
    assert.include(html, 'data-l10n-id="zopilot-pref-nav-prompts"');
    assert.include(html, "lucide-pencil-sparkles");
    assert.include(html, 'data-l10n-id="zopilot-pref-provider-title"');
    assert.include(html, 'data-l10n-id="zopilot-pref-provider-add-action"');
    assert.include(html, 'class="zp-single-select"');
    assert.include(html, 'data-variant="form"');
    assert.include(html, "lucide-chevron-down");
    assert.notInclude(html, "zp-pref-provider-create");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-provider-kind"');
    assert.notInclude(html, "zp-pref-sidebar");
    assert.notInclude(html, "zp-pref-card");
    assert.notInclude(html, "<select");
    assert.notInclude(html, "zp-pref-brand");
  });

  it("wraps horizontal preference navigation and resolves Home and End", function () {
    assert.equal(
      findNextPreferenceSection("providers", "ArrowLeft"),
      "prompts",
    );
    assert.equal(
      findNextPreferenceSection("prompts", "ArrowRight"),
      "providers",
    );
    assert.equal(
      findNextPreferenceSection("dependencies", "Home"),
      "providers",
    );
    assert.equal(findNextPreferenceSection("providers", "End"), "prompts");
    assert.isUndefined(findNextPreferenceSection("providers", "ArrowDown"));
  });

  it("does not overwrite a saved API key when the edit form leaves it unchanged", function () {
    const unchanged = createProviderUpdateInput({
      displayName: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-saved-secret",
      savedApiKey: "sk-saved-secret",
    });
    const changed = createProviderUpdateInput({
      displayName: "DeepSeek",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-new-secret",
      savedApiKey: "sk-saved-secret",
    });

    assert.notProperty(unchanged, "apiKey");
    assert.equal(changed.apiKey, "sk-new-secret");
  });

  it("renders providers as controlled collapsed and expanded summary rows", function () {
    const collapsed = renderToStaticMarkup(
      <ProviderCard
        checking={false}
        expanded={false}
        onCheck={() => undefined}
        onDelete={() => undefined}
        onReadApiKey={() => ""}
        onSetModelVisibility={() => undefined}
        onToggle={() => undefined}
        onUpdate={() => undefined}
        profile={TEST_PROVIDER}
      />,
    );
    const expanded = renderToStaticMarkup(
      <ProviderCard
        checking={false}
        expanded
        onCheck={() => undefined}
        onDelete={() => undefined}
        onReadApiKey={() => ""}
        onSetModelVisibility={() => undefined}
        onToggle={() => undefined}
        onUpdate={() => undefined}
        profile={TEST_PROVIDER}
      />,
    );

    assert.include(collapsed, "zp-pref-provider-summary");
    assert.include(collapsed, 'aria-expanded="false"');
    assert.notInclude(collapsed, "zp-pref-provider-details");
    assert.include(expanded, 'aria-expanded="true"');
    assert.include(expanded, "zp-pref-provider-details");
    assert.notInclude(expanded, "zp-pref-card");
    assert.equal(
      countOccurrences(
        expanded,
        'data-l10n-id="zopilot-pref-provider-status-connected"',
      ),
      1,
    );
    assert.equal(
      countOccurrences(
        expanded,
        'data-l10n-id="zopilot-pref-provider-key-saved-button"',
      ),
      1,
    );
    assert.notInclude(expanded, "pref-provider-models-visibility");
    assert.include(expanded, "zp-pref-provider-key-button");
    assert.include(expanded, 'data-saved="true"');
    assert.equal(
      countOccurrences(expanded, 'class="zp-pref-icon-button-tooltip"'),
      3,
    );
    assert.include(expanded, 'data-l10n-id="zopilot-pref-provider-key-saved"');
    assert.include(expanded, "GPT-5");
    assert.include(expanded, "zp-pref-provider-model-list");
    assert.equal(countOccurrences(expanded, 'type="checkbox"'), 1);
    assert.include(expanded, 'disabled=""');
  });

  it("hides the provider status icon while testing the connection", function () {
    const html = renderToStaticMarkup(
      <ProviderCard
        checking
        expanded={false}
        onCheck={() => undefined}
        onDelete={() => undefined}
        onReadApiKey={() => ""}
        onSetModelVisibility={() => undefined}
        onToggle={() => undefined}
        onUpdate={() => undefined}
        profile={TEST_PROVIDER}
      />,
    );

    assert.include(
      html,
      'data-l10n-id="zopilot-pref-provider-status-checking"',
    );
    assert.equal(countOccurrences(html, "zp-pref-spin"), 1);
  });

  it("keeps provider expansion states independent", function () {
    const firstExpanded = toggleProviderExpansion(new Set(), "provider-a");
    const bothExpanded = toggleProviderExpansion(firstExpanded, "provider-b");
    const secondOnly = toggleProviderExpansion(bothExpanded, "provider-a");

    assert.deepEqual([...bothExpanded], ["provider-a", "provider-b"]);
    assert.deepEqual([...secondOnly], ["provider-b"]);
  });

  it("renders every Codex model as a separate visibility row", function () {
    const html = renderToStaticMarkup(
      <ProviderCard
        checking={false}
        expanded
        onCheck={() => undefined}
        onDelete={() => undefined}
        onReadApiKey={() => ""}
        onSetModelVisibility={() => undefined}
        onToggle={() => undefined}
        onUpdate={() => undefined}
        profile={{
          ...TEST_PROVIDER,
          id: "codex-cli.default",
          kind: "codex-cli",
          providerId: "codex",
          displayName: "Codex CLI",
          models: Array.from({ length: 5 }, (_, index) => ({
            id: `gpt-${index + 1}`,
            displayName: `GPT ${index + 1}`,
            supportedReasoningEfforts: [],
          })),
        }}
      />,
    );

    assert.equal(countOccurrences(html, 'type="checkbox"'), 5);
    assert.include(html, "GPT 5");
  });

  it("hides the add-provider action before a model is selected", function () {
    const html = renderToStaticMarkup(
      <AddProviderForm
        onCancel={() => undefined}
        onCreate={() => undefined}
        onCreated={() => undefined}
        onListModels={async () => []}
      />,
    );

    assert.include(html, "zp-pref-provider-model-step");
    assert.include(html, "zp-pref-provider-model-area");
    assert.notInclude(html, "zp-pref-provider-create-actions");
    assert.notInclude(html, "zp-pref-button-primary");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-provider-step-add"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-provider-add"');
    assert.isBelow(
      html.indexOf("zp-pref-provider-model-step"),
      html.indexOf('data-l10n-id="zopilot-pref-provider-step-models"'),
    );
  });

  it("updates model selections without retaining the checkbox event", function () {
    assert.deepEqual(
      updateSelectedModelIds(["deepseek-v4-flash"], "deepseek-v4-pro", true),
      ["deepseek-v4-flash", "deepseek-v4-pro"],
    );
    assert.deepEqual(
      updateSelectedModelIds(
        ["deepseek-v4-flash", "deepseek-v4-pro"],
        "deepseek-v4-pro",
        false,
      ),
      ["deepseek-v4-flash"],
    );
  });

  it("renders prompt list mode without the editor form", function () {
    const html = renderToStaticMarkup(
      <PromptPanel
        body=""
        hasUnsavedChanges={false}
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
    assert.include(html, "zp-pref-prompt-row-separator");
    assert.include(html, "Summarize the selected paper.");
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-new"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-title-label"');
    assert.notInclude(html, "zp-pref-editor-card");
  });

  it("expands an existing prompt editor beneath its list row", function () {
    const html = renderToStaticMarkup(
      <PromptPanel
        body="Summarize the selected paper."
        hasUnsavedChanges
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

    assert.include(html, "zp-pref-prompt-list-panel");
    assert.include(html, 'aria-expanded="true"');
    assert.include(html, 'data-expanded="true"');
    assert.include(html, 'data-inline="true"');
    assert.include(html, 'id="zp-pref-prompt-editor-custom-a"');
    assert.notInclude(html, "zp-pref-prompt-edit-page");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-back-button"');
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-new"');
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-save"');
    assert.notMatch(
      html,
      /<button(?=[^>]*disabled="")[^>]*>[\s\S]*?data-l10n-id="zopilot-pref-prompt-save"/,
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-title-label"');
  });

  it("expands the new prompt editor above the prompt list", function () {
    const html = renderToStaticMarkup(
      <PromptPanel
        body=""
        hasUnsavedChanges={false}
        mode="edit"
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
    assert.include(html, "zp-pref-prompt-create-item");
    assert.include(html, 'aria-expanded="true"');
    assert.include(html, 'id="zp-pref-prompt-new-editor"');
    assert.include(html, 'data-inline="true"');
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-save"');
    assert.match(
      html,
      /<button(?=[^>]*disabled="")[^>]*>[\s\S]*?data-l10n-id="zopilot-pref-prompt-save"/,
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-prompt-new"');
    assert.notInclude(html, "zp-pref-prompt-edit-page");
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-back-button"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-prompt-delete"');
    assert.isBelow(
      html.indexOf("zp-pref-prompt-create-item"),
      html.indexOf("Prompt A"),
    );
  });

  it("collapses a newly saved prompt but keeps existing edits expanded", function () {
    assert.equal(getPromptModeAfterSave(), "list");
    assert.equal(getPromptModeAfterSave("custom-a"), "edit");
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
    assert.equal(
      countOccurrences(
        html,
        'data-l10n-id="zopilot-pref-dependencies-description"',
      ),
      1,
    );
    assert.notInclude(
      html,
      'data-l10n-id="zopilot-pref-pdf-helper-card-description"',
    );
    assert.equal(countOccurrences(html, 'class="zp-pref-code-scroller"'), 3);
    assert.include(html, 'tabindex="0"');
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-installed-version"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-latest-version"',
    );
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-dependencies-update"');
    assert.notInclude(html, 'data-l10n-id="zopilot-pref-dependencies-install"');
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-copy-button"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-reveal-button"',
    );
    assert.include(
      html,
      'data-l10n-id="zopilot-pref-dependencies-open-url-button"',
    );
    assert.equal(
      countOccurrences(html, 'class="zp-pref-icon-button-tooltip"'),
      6,
    );
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-copy"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-reveal"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-open-url"');
    assert.include(html, 'data-l10n-id="zopilot-pref-dependencies-remove"');
  });

  it("renders a focusable single-line code scroller without actions", function () {
    const html = renderToStaticMarkup(
      <PreferenceCodeScroller
        aria-label="Install directory"
        value="/very/long/path"
      />,
    );

    assert.include(html, 'class="zp-pref-code-scroller"');
    assert.include(html, 'class="zp-pref-code-scroller-value"');
    assert.include(html, 'aria-label="Install directory"');
    assert.include(html, 'tabindex="0"');
    assert.include(html, "/very/long/path");
    assert.notInclude(html, "<button");
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

const TEST_PROVIDER: ProviderProfile = {
  id: "provider-openrouter",
  kind: "openai-compatible",
  providerId: "openrouter",
  displayName: "OpenRouter",
  baseURL: "https://openrouter.ai/api/v1",
  hasApiKey: true,
  models: [
    {
      id: "openai/gpt-5",
      displayName: "GPT-5",
      supportedReasoningEfforts: [],
    },
  ],
  capabilities: {
    streaming: true,
    tools: true,
    images: true,
    cancellation: true,
    modelListing: true,
    reasoning: true,
    structuredOutput: false,
    usageMetadata: true,
  },
  timeoutMs: 30_000,
  retryCount: 1,
  enabled: true,
  status: "connected",
};

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

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
