import { assert } from "chai";
import {
  buildModelSelectionPatch,
  parseSavedReasoningEfforts,
} from "../../../src/modules/sidebar/modelPreferences.ts";
import type { SidebarModelView } from "../../../src/modules/sidebar/app/types.ts";

describe("sidebar model preferences", function () {
  it("keeps a saved reasoning effort when the selected model still supports it", function () {
    const patch = buildModelSelectionPatch(models, "gpt-fast", {
      "gpt-fast": "high",
    });

    assert.equal(patch.selectedModel, "gpt-fast");
    assert.deepEqual(patch.availableReasoningEfforts, [
      "low",
      "medium",
      "high",
    ]);
    assert.equal(patch.selectedReasoningEffort, "high");
  });

  it("falls back to the model default when the saved effort is stale", function () {
    const patch = buildModelSelectionPatch(models, "gpt-fast", {
      "gpt-fast": "unsupported",
    });

    assert.equal(patch.selectedReasoningEffort, "medium");
  });

  it("falls back to the first supported effort when no saved or default effort applies", function () {
    const patch = buildModelSelectionPatch(
      [
        {
          slug: "gpt-custom",
          displayName: "GPT Custom",
          supportedReasoningEfforts: ["minimal", "medium"],
          defaultReasoningEffort: "high",
        },
      ],
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
});

const models: SidebarModelView[] = [
  {
    slug: "gpt-fast",
    displayName: "GPT Fast",
    supportedReasoningEfforts: ["low", "medium", "high"],
    defaultReasoningEffort: "medium",
  },
  {
    slug: "gpt-basic",
    displayName: "GPT Basic",
    supportedReasoningEfforts: ["medium"],
    defaultReasoningEffort: "medium",
  },
];
