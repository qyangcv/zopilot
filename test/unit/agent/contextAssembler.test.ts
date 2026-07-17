import { assert } from "chai";
import { buildStatelessAgentPrompt } from "../../../src/application/agent/prompt/contextAssembler.ts";
import type { Conversation } from "../../../src/domain/conversation.ts";

describe("agent context assembler", function () {
  it("adds full selected note contents to each assembled prompt", function () {
    const conversation = createConversation();
    conversation.messages.push({
      id: "old-user",
      conversationId: conversation.metadata.id,
      role: "user",
      text: "Earlier question",
      createdAt: "2026-07-17T00:00:00.000Z",
      status: "complete",
      noteContexts: [createNoteReference()],
    });

    const prompt = buildStatelessAgentPrompt({
      conversation,
      prompt: "Current question",
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
    assert.include(prompt, "--- END ZOTERO NOTE 1 ---");
    assert.equal(count(prompt, "Full current note body"), 1);
    assert.notInclude(prompt, '"noteContexts"');
  });
});

function createConversation(): Conversation {
  return {
    metadata: {
      id: "conv-a",
      scope: "workspace",
      workspaceKey: "item:1:PAPER",
      workspaceType: "item",
      workspaceLabel: "Paper",
      workspaceTitle: "Paper",
      libraryID: 1,
      itemKey: "PAPER",
      defaultSource: {
        paperKey: "1:PAPER",
        libraryID: 1,
        parentItemID: 1,
        parentItemKey: "PAPER",
        attachmentItemID: 11,
        attachmentKey: "PDF",
        title: "Paper",
      },
      label: "Question",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    messages: [],
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
