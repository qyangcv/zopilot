import { assert } from "chai";
import {
  buildModelSelectionPatch,
  createReasoningPreferenceKey,
  parseSavedReasoningEfforts,
  parseSavedSelectedModels,
  resolveSelectedModel,
} from "../../../src/features/sidebar/providers/modelPreferences.ts";
import type { SidebarModelView } from "../../../src/features/sidebar/ui/types.ts";

describe("sidebar model preferences", function () {
  it("keeps a saved reasoning effort when the selected model still supports it", function () {
    const patch = buildModelSelectionPatch(
      models,
      "codex-cli.default",
      "gpt-fast",
      {
        [createReasoningPreferenceKey("codex-cli.default", "gpt-fast")]: "high",
      },
    );

    assert.equal(patch.selectedProviderId, "codex-cli.default");
    assert.equal(patch.selectedModel, "gpt-fast");
    assert.deepEqual(patch.availableReasoningEfforts, [
      "low",
      "medium",
      "high",
    ]);
    assert.equal(patch.selectedReasoningEffort, "high");
  });

  it("falls back to the model default when the saved effort is stale", function () {
    const patch = buildModelSelectionPatch(
      models,
      "codex-cli.default",
      "gpt-fast",
      {
        "gpt-fast": "unsupported",
      },
    );

    assert.equal(patch.selectedReasoningEffort, "medium");
  });

  it("falls back to the first supported effort when no saved or default effort applies", function () {
    const patch = buildModelSelectionPatch(
      [
        {
          slug: "gpt-custom",
          displayName: "GPT Custom",
          providerProfileId: "custom",
          providerLabel: "Custom",
          supportedReasoningEfforts: ["minimal", "medium"],
          defaultReasoningEffort: "high",
        },
      ],
      "custom",
      "gpt-custom",
      {},
    );

    assert.equal(patch.selectedReasoningEffort, "minimal");
  });

  it("ignores invalid saved reasoning effort payloads", function () {
    assert.deepEqual(parseSavedReasoningEfforts("not json"), {});
    assert.deepEqual(parseSavedReasoningEfforts('{"gpt":"high","bad":false}'), {
      gpt: "high",
    });
    assert.deepEqual(parseSavedReasoningEfforts(["not", "an", "object"]), {});
  });

  it("restores the saved model for the active provider", function () {
    const selected = resolveSelectedModel({
      models: [
        ...models,
        {
          slug: "deepseek-reasoner",
          displayName: "DeepSeek Reasoner",
          providerProfileId: "deepseek.custom",
          providerLabel: "DeepSeek",
          supportedReasoningEfforts: ["low", "medium", "high"],
          defaultReasoningEffort: "medium",
        },
      ],
      activeProviderId: "deepseek.custom",
      currentProviderId: "codex-cli.default",
      currentModel: "gpt-fast",
      savedSelectedModels: {
        "deepseek.custom": "deepseek-reasoner",
      },
    });

    assert.equal(selected?.providerProfileId, "deepseek.custom");
    assert.equal(selected?.slug, "deepseek-reasoner");
  });

  it("uses the active provider instead of the initial Codex default", function () {
    const selected = resolveSelectedModel({
      models: [
        ...models,
        {
          slug: "deepseek-chat",
          displayName: "DeepSeek Chat",
          providerProfileId: "deepseek.custom",
          providerLabel: "DeepSeek",
          supportedReasoningEfforts: ["low", "medium", "high"],
          defaultReasoningEffort: "medium",
        },
      ],
      activeProviderId: "deepseek.custom",
      currentProviderId: "codex-cli.default",
      currentModel: "gpt-fast",
      savedSelectedModels: {},
    });

    assert.equal(selected?.providerProfileId, "deepseek.custom");
    assert.equal(selected?.slug, "deepseek-chat");
  });

  it("falls back within the active provider when the current model is hidden", function () {
    const selected = resolveSelectedModel({
      models: [models[1]],
      activeProviderId: "codex-cli.default",
      currentProviderId: "codex-cli.default",
      currentModel: "gpt-fast",
      savedSelectedModels: {
        "codex-cli.default": "gpt-fast",
      },
    });

    assert.equal(selected?.providerProfileId, "codex-cli.default");
    assert.equal(selected?.slug, "gpt-basic");
  });

  it("ignores invalid saved selected model payloads", function () {
    assert.deepEqual(parseSavedSelectedModels("not json"), {});
    assert.deepEqual(parseSavedSelectedModels('{"provider":"model","bad":1}'), {
      provider: "model",
    });
    assert.deepEqual(parseSavedSelectedModels(["not", "an", "object"]), {});
  });
});

const models: SidebarModelView[] = [
  {
    slug: "gpt-fast",
    displayName: "GPT Fast",
    providerProfileId: "codex-cli.default",
    providerLabel: "Codex CLI",
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
  },
  {
    slug: "gpt-basic",
    displayName: "GPT Basic",
    providerProfileId: "codex-cli.default",
    providerLabel: "Codex CLI",
    supportedReasoningEfforts: ["medium"],
    defaultReasoningEffort: "medium",
  },
];
