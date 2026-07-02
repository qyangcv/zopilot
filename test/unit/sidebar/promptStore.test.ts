import { assert } from "chai";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadPromptViews,
  updateCustomPrompt,
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

  it("updates custom prompts and recalculates variables", function () {
    const prompt = createCustomPrompt({
      title: "Evidence table",
      body: "Make a table for {{paper}}.",
    });

    const updated = updateCustomPrompt(prompt.id, {
      title: "  Method audit  ",
      body: "Check {{method}} against {{ paper }}.",
    });

    assert.equal(updated.id, prompt.id);
    assert.equal(updated.title, "Method audit");
    assert.deepEqual(updated.variables, ["method", "paper"]);
    assert.deepInclude(loadPromptViews(), updated);
  });

  it("ignores malformed stored prompts", function () {
    installZoteroMock(
      JSON.stringify([
        {
          id: "custom-valid",
          title: "Valid",
          body: "Read {{paper}}.",
          variables: ["paper"],
          scope: "global",
          updatedAt: "2026-06-13T07:00:00.000Z",
          custom: true,
        },
        {
          id: "prompt-old-default",
          title: "Old default",
          body: "This came from a removed default prompt.",
          variables: [],
          scope: "global",
          updatedAt: "2026-06-13T07:00:00.000Z",
          custom: false,
        },
      ]),
    );

    assert.deepEqual(
      loadPromptViews().map((prompt) => prompt.id),
      ["custom-valid"],
    );
  });

  it("throws when updating a missing custom prompt", function () {
    assert.throws(
      () =>
        updateCustomPrompt("custom-missing", {
          title: "Missing",
          body: "Body",
        }),
      /Prompt not found/,
    );
  });
});

function installZoteroMock(initialValue = "[]"): void {
  let customPrompts = initialValue;
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
