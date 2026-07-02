import { assert } from "chai";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadPromptViews,
} from "../../../src/modules/sidebar/promptStore.ts";
import {
  extractPromptVariables,
  validatePromptInput,
} from "../../../src/modules/sidebar/promptSchema.ts";

describe("sidebar prompt store", function () {
  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("extracts unique prompt variables", function () {
    assert.deepEqual(
      extractPromptVariables(
        "Compare {{paper}} with {{ paper }} for {{goal_1}}.",
      ),
      ["paper", "goal_1"],
    );
  });

  it("rejects invalid variable names", function () {
    assert.throws(
      () =>
        validatePromptInput({
          title: "Bad",
          body: "Use {{1bad}}",
        }),
      /Invalid prompt variable/,
    );
  });

  it("persists and deletes custom prompts", function () {
    const prompt = createCustomPrompt({
      title: "  Evidence table  ",
      body: "Make a table for {{paper}}.",
    });

    assert.equal(prompt.title, "Evidence table");
    assert.isTrue(prompt.custom);
    assert.includeMembers(
      loadPromptViews().map((item) => item.id),
      [prompt.id],
    );

    deleteCustomPrompt(prompt.id);

    assert.notInclude(
      loadPromptViews().map((item) => item.id),
      prompt.id,
    );
  });
});

function installZoteroMock(): void {
  let customPrompts = "[]";
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
        return key.endsWith("prompts.custom") ? customPrompts : undefined;
      },
      set(key, value) {
        if (key.endsWith("prompts.custom")) {
          customPrompts = String(value);
        }
      },
    },
  };
}
