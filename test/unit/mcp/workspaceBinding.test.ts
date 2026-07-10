import { assert } from "chai";
import type { ConversationMetadata } from "../../../src/domain/conversation.ts";
import {
  conversationToWorkspaceQueryScope,
  createPaperBindingHeaders,
  parsePaperBindingHeaders,
} from "../../../src/integrations/mcp/workspaceBinding.ts";

describe("workspace binding codec", function () {
  it("produces the same workspace scope for HTTP headers and BYOK calls", function () {
    const conversation = createConversationMetadata();
    const parsed = parsePaperBindingHeaders(
      createPaperBindingHeaders(conversation),
    );

    assert.isTrue(parsed.ok);
    if (parsed.ok) {
      assert.deepEqual(
        parsed.value,
        conversationToWorkspaceQueryScope(conversation),
      );
    }
  });
});

function createConversationMetadata(): ConversationMetadata {
  return {
    id: "conv-binding",
    scope: "workspace",
    workspaceKey: "collection:1:COLL",
    workspaceType: "collection",
    workspaceLabel: "Research",
    workspaceTitle: "Research",
    libraryID: 1,
    collectionKey: "COLL",
    collectionPath: ["Parent", "Research"],
    defaultSource: {
      paperKey: "1:ITEM",
      libraryID: 1,
      parentItemID: 10,
      parentItemKey: "ITEM",
      attachmentItemID: 11,
      attachmentKey: "PDF",
      title: "Paper",
    },
    label: "Question",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}
