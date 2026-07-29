import { assert } from "chai";
import { buildCurrentTurnPrompt } from "../../../src/application/agent/prompt/contextAssembler.ts";
import type { ThreadRunInput } from "../../../src/domain/thread.ts";

describe("agent context assembler", function () {
  it("adds current note and active paper context without duplicating input", function () {
    const run = createRunInput();
    const prompt = buildCurrentTurnPrompt({
      run,
      resolvedNoteContexts: [
        {
          reference: createNoteReference(),
          content: "Full current note body",
        },
      ],
    });

    assert.include(prompt, "Full current note body");
    assert.include(prompt, "untrusted reference material");
    assert.include(prompt, "--- BEGIN ZOTERO NOTE 1 ---");
    assert.include(prompt, '"title":"Reading notes"');
    assert.include(prompt, '"sourceId":"source-a"');
    assert.equal(count(prompt, "Current question"), 1);
    assert.notInclude(prompt, "Earlier question");
  });
});

function createRunInput(): ThreadRunInput {
  const source = {
    sourceId: "source-a",
    paperKey: "1:PAPER",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    attachmentItemID: 11,
    attachmentKey: "PDF",
    title: "Paper",
  };
  return {
    threadId: "thread-a",
    turnId: "turn-2",
    sequence: 2,
    prompt: "Current question",
    history: [
      {
        sequence: 1,
        userText: "Earlier question",
        assistantText: "Earlier answer",
        status: "completed",
      },
    ],
    context: {
      sources: [source],
      selectedSources: [],
      primarySourceId: source.sourceId,
      noteContexts: [createNoteReference()],
      localAttachments: [],
    },
    workspace: {
      id: "thread-a",
      workspaceKey: "item:1:PAPER",
      workspaceType: "item",
      workspaceLabel: "Paper",
      workspaceTitle: "Paper",
      libraryID: 1,
      itemKey: "PAPER",
    },
    providerProfileId: "provider-a",
  };
}

function createNoteReference() {
  return {
    id: "note:1:NOTE",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    noteItemID: 21,
    noteItemKey: "NOTE",
    title: "Reading notes",
    dateModified: "2026-07-17 10:00:00",
  };
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
