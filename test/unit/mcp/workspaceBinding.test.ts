import { assert } from "chai";
import type { ThreadWorkspaceBinding } from "../../../src/integrations/mcp/workspaceBinding.ts";
import {
  createPaperBindingHeaders,
  parsePaperBindingHeaders,
  threadContextToWorkspaceQueryScope,
} from "../../../src/integrations/mcp/workspaceBinding.ts";

describe("workspace binding codec", function () {
  it("round-trips the complete turn source snapshot", function () {
    const binding = createBinding();
    binding.context.sources.push({
      sourceId: "1-PDF-B",
      paperKey: "1:ITEM-B",
      libraryID: 1,
      parentItemID: 20,
      parentItemKey: "ITEM-B",
      attachmentItemID: 21,
      attachmentKey: "PDF-B",
      title: "Paper B",
    });
    const parsed = parsePaperBindingHeaders(createPaperBindingHeaders(binding));

    assert.isTrue(parsed.ok);
    if (parsed.ok) {
      assert.deepEqual(
        parsed.value,
        threadContextToWorkspaceQueryScope(binding),
      );
      assert.deepEqual(
        parsed.value.sources.map((source) => source.sourceId),
        ["1-PDF-A", "1-PDF-B"],
      );
    }
  });

  it("round-trips a standalone PDF without parent fields", function () {
    const binding = createBinding();
    binding.workspace.workspaceKey = "item:1:PDF";
    binding.workspace.itemKey = "PDF";
    binding.context.sources = [
      {
        sourceId: "1-PDF",
        paperKey: "1:PDF",
        libraryID: 1,
        attachmentItemID: 11,
        attachmentKey: "PDF",
        title: "Standalone.pdf",
      },
    ];
    binding.context.primarySourceId = "1-PDF";

    const parsed = parsePaperBindingHeaders(createPaperBindingHeaders(binding));

    assert.isTrue(parsed.ok);
    if (parsed.ok) {
      assert.isUndefined(parsed.value.sources[0]?.parentItemID);
      assert.isUndefined(parsed.value.sources[0]?.parentItemKey);
    }
  });

  it("rejects a primary source outside the turn snapshot", function () {
    const binding = createBinding();
    const headers = createPaperBindingHeaders(binding);
    headers["X-Zopilot-Primary-Source-ID"] = "1-NOT-ACTIVE";

    const parsed = parsePaperBindingHeaders(headers);

    assert.isFalse(parsed.ok);
  });
});

function createBinding(): ThreadWorkspaceBinding {
  return {
    workspace: {
      id: "thread-binding",
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection",
      workspaceLabel: "Research",
      workspaceTitle: "Research",
      libraryID: 1,
      collectionKey: "COLL",
      collectionPath: ["Parent", "Research"],
    },
    context: {
      sources: [
        {
          sourceId: "1-PDF-A",
          paperKey: "1:ITEM-A",
          libraryID: 1,
          parentItemID: 10,
          parentItemKey: "ITEM-A",
          attachmentItemID: 11,
          attachmentKey: "PDF-A",
          title: "Paper A",
        },
      ],
      selectedSources: [],
      primarySourceId: "1-PDF-A",
      noteContexts: [],
      localAttachments: [],
    },
  };
}
