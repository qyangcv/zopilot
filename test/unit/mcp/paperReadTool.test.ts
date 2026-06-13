import { assert } from "chai";
import type { PaperScope } from "../../../src/zotero/types.ts";
import { createPaperReadTool } from "../../../src/mcp/tools/paperRead.ts";

describe("paper_read MCP tool", function () {
  it("exposes only the paper_read definition for Step 5.2", function () {
    const tool = createTool();

    assert.equal(tool.definition.name, "paper_read");
    assert.isTrue(tool.definition.annotations?.readOnlyHint);
  });

  it("calls paper_read and returns Zotero full-text evidence snippets", async function () {
    const tool = createTool(
      {
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
      },
      "The paper introduces a retrieval augmented method for reading PDFs. Evaluation details are elsewhere. The method uses lexical chunk ranking.",
    );

    const result = await tool.call({
      question: "What is the retrieval method?",
    });

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "retrieval augmented method");
    assert.notInclude(result.content[0].text, "paper_read");
    assert.notInclude(result.content[0].text, "Current paper scope");
    assert.notInclude(result.content[0].text, "[snippet");
    assert.notProperty(result, "structuredContent");
    assert.notInclude(JSON.stringify(result), "chunkIndex");
    assert.notInclude(JSON.stringify(result), "charStart");
    assert.notInclude(JSON.stringify(result), "score");
    assert.notInclude(JSON.stringify(result), "/tmp");
  });

  it("returns no_text when the current reader PDF has no Zotero full-text", async function () {
    const tool = createTool(
      {
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
      },
      "",
    );

    const result = await tool.call({
      question: "What is the method?",
    });

    assert.isTrue(result.isError);
    assert.equal(
      result.content[0].text,
      "The current PDF has no readable Zotero full text.",
    );
    assert.notProperty(result, "structuredContent");
  });

  it("returns no_active_reader when paper_read has no PDF reader scope", async function () {
    const tool = createTool(null);

    const result = await tool.call({
      question: "What is the method?",
    });

    assert.isTrue(result.isError);
    assert.equal(
      result.content[0].text,
      "No active Zotero PDF reader paper is available.",
    );
    assert.notProperty(result, "structuredContent");
  });

  it("calls paper_read without returning local attachment paths", async function () {
    const tool = createTool({
      attachmentItemID: 10,
      attachmentKey: "PDF",
      libraryID: 1,
      parentItemID: 20,
    });

    const result = await tool.call({
      question: "What is the method?",
    });

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "lexical retrieval");
    assert.notProperty(result, "structuredContent");
    assert.notInclude(JSON.stringify(result), "/tmp");
  });

  it("rejects unsupported paper_read input fields", async function () {
    const tool = createTool(null);

    try {
      await tool.call({
        itemId: 1,
      });
      assert.fail("Expected invalid input to fail");
    } catch (error) {
      assert.include(
        String(error),
        "paper_read input contains unsupported field: itemId",
      );
    }
  });
});

function createTool(
  scope: PaperScope | null = null,
  text = "The method uses lexical retrieval.",
) {
  return createPaperReadTool({
    resolveActivePaper: async () => scope,
    readPaperText: async () => text,
  });
}
