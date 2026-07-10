import { assert } from "chai";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadPromptViews,
  subscribePromptViews,
  updateCustomPrompt,
} from "../../../src/features/sidebar/prompts/promptStore.ts";

describe("sidebar prompt store", function () {
  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
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

  it("notifies prompt view subscribers when prompts change", function () {
    const snapshots: string[][] = [];
    const unsubscribe = subscribePromptViews((prompts) => {
      snapshots.push(prompts.map((prompt) => prompt.title));
    });

    try {
      const prompt = createCustomPrompt({
        title: "Evidence table",
        body: "Make a table.",
      });
      updateCustomPrompt(prompt.id, {
        title: "Method audit",
        body: "Check the method.",
      });
      deleteCustomPrompt(prompt.id);
    } finally {
      unsubscribe();
    }

    assert.deepEqual(snapshots, [["Evidence table"], ["Method audit"], []]);
  });

  it("updates custom prompts and treats template markers as plain text", function () {
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
    assert.equal(updated.body, "Check {{method}} against {{ paper }}.");
    assert.deepInclude(loadPromptViews(), updated);
  });

  it("ignores malformed stored prompts", function () {
    installZoteroMock(
      JSON.stringify([
        {
          id: "custom-valid",
          title: "Valid",
          body: "Read {{paper}}.",
          scope: "global",
          updatedAt: "2026-06-13T07:00:00.000Z",
          custom: true,
        },
        {
          id: "prompt-old-default",
          title: "Old default",
          body: "This came from a removed default prompt.",
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
