import { assert } from "chai";
import type { PaperScope } from "../../../src/zotero/types.ts";
import { createPaperReadTool } from "../../../src/mcp/tools/paperRead.ts";
import {
  PAPER_BINDING_MISSING_MESSAGE,
  type BoundPaperScope,
} from "../../../src/mcp/paperBinding.ts";

describe("paper_read MCP tool", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("exposes only the paper_read definition for Step 5.2", function () {
    const tool = createTool();

    assert.equal(tool.definition.name, "paper_read");
    assert.isTrue(tool.definition.annotations?.readOnlyHint);
  });

  it("calls paper_read with the bound paper and returns evidence snippets", async function () {
    const scope = createScope({
      attachmentItemID: 10,
      attachmentKey: "PDF-A",
      libraryID: 1,
      parentItemID: 20,
    });
    const tool = createPaperReadTool({
      readPaperText: async (paper) =>
        paper.attachmentKey === "PDF-A"
          ? "The paper introduces a retrieval augmented method for reading PDFs. Evaluation details are elsewhere. The method uses lexical chunk ranking."
          : "Wrong paper text.",
    });

    const result = await tool.call(
      {
        question: "What is the retrieval method?",
      },
      { paperScope: scope },
    );

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "retrieval augmented method");
    assert.notInclude(result.content[0].text, "Wrong paper text");
    assert.notInclude(result.content[0].text, "paper_read");
    assert.notInclude(result.content[0].text, "Current paper scope");
    assert.notInclude(result.content[0].text, "[snippet");
    assert.notProperty(result, "structuredContent");
    assert.notInclude(JSON.stringify(result), "chunkIndex");
    assert.notInclude(JSON.stringify(result), "charStart");
    assert.notInclude(JSON.stringify(result), "score");
    assert.notInclude(JSON.stringify(result), "/tmp");
  });

  it("returns no_text when the bound PDF has no Zotero full-text", async function () {
    const tool = createTool("");

    const result = await tool.call(
      {
        question: "What is the method?",
      },
      { paperScope: createScope() },
    );

    assert.isTrue(result.isError);
    assert.equal(
      result.content[0].text,
      "The bound PDF has no readable Zotero full text.",
    );
    assert.notProperty(result, "structuredContent");
  });

  it("returns an error when paper_read has no bound paper scope", async function () {
    const tool = createTool();

    const result = await tool.call(
      {
        question: "What is the method?",
      },
      {},
    );

    assert.isTrue(result.isError);
    assert.equal(result.content[0].text, PAPER_BINDING_MISSING_MESSAGE);
    assert.notProperty(result, "structuredContent");
  });

  it("calls paper_read without returning local attachment paths", async function () {
    const tool = createTool();

    const result = await tool.call(
      {
        question: "What is the method?",
      },
      { paperScope: createScope() },
    );

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "lexical retrieval");
    assert.notProperty(result, "structuredContent");
    assert.notInclude(JSON.stringify(result), "/tmp");
  });

  it("rejects unsupported paper_read input fields", async function () {
    const tool = createTool();

    try {
      await tool.call(
        {
          itemId: 1,
        },
        { paperScope: createScope() },
      );
      assert.fail("Expected invalid input to fail");
    } catch (error) {
      assert.include(
        String(error),
        "paper_read input contains unsupported field: itemId",
      );
    }
  });

  it("rejects stale bound attachment metadata instead of reading another PDF", async function () {
    installZoteroMock({
      id: 10,
      key: "ACTUAL-PDF",
      libraryID: 1,
      attachmentText: "The method should not be read.",
    });
    const tool = createPaperReadTool({
      logger: () => undefined,
    });

    const result = await tool.call(
      {
        question: "method",
      },
      {
        paperScope: createScope({
          attachmentItemID: 10,
          attachmentKey: "STALE-PDF",
          libraryID: 1,
        }),
      },
    );

    assert.isTrue(result.isError);
    assert.include(
      result.content[0].text,
      "Bound Zotero attachment no longer matches this thread.",
    );
    assert.notInclude(result.content[0].text, "The method should not be read.");
  });
});

function createTool(text = "The method uses lexical retrieval.") {
  return createPaperReadTool({
    readPaperText: async () => text,
  });
}

function createScope(overrides: Partial<PaperScope> = {}): BoundPaperScope {
  return {
    conversationId: "conv-a",
    paperKey: "1:PAPER-A",
    attachmentItemID: 10,
    attachmentKey: "PDF",
    libraryID: 1,
    parentItemID: 20,
    ...overrides,
  };
}

function installZoteroMock(attachment: {
  id: number;
  key: string;
  libraryID: number;
  attachmentText: string;
}): void {
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Items: {
      get: (itemID: number) =>
        itemID === attachment.id
          ? {
              ...attachment,
              isAttachment: () => true,
              isPDFAttachment: () => true,
            }
          : undefined,
    },
  };
}
