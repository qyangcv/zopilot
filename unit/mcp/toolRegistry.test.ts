import { assert } from "chai";
import type { PaperScope, PaperTextResult } from "../../src/zotero/types.ts";
import { McpToolRegistry } from "../../src/mcp/toolRegistry.ts";
import { createPaperReadTool } from "../../src/mcp/tools/paperRead.ts";

describe("McpToolRegistry", function () {
  it("lists only paper_read for Step 5.2", function () {
    const registry = createRegistry();

    const tools = registry.listTools();

    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["paper_read"],
    );
    assert.isTrue(tools[0].annotations?.readOnlyHint);
  });

  it("rejects unknown tools", async function () {
    const registry = createRegistry();

    try {
      await registry.callTool("paper_search", {});
      assert.fail("Expected unknown tool to fail");
    } catch (error) {
      assert.include(String(error), "Unknown MCP tool: paper_search");
    }
  });

  it("calls paper_read and returns Zotero full-text evidence snippets", async function () {
    const registry = createRegistry(
      {
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
        readerItemID: 10,
        readerType: "pdf",
        source: "reader",
        warnings: [],
      },
      createTextResult(
        "The paper introduces a retrieval augmented method for reading PDFs. Evaluation details are elsewhere. The method uses lexical chunk ranking.",
      ),
    );

    const result = await registry.callTool("paper_read", {
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
    const registry = createRegistry(
      {
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
        readerItemID: 10,
        readerType: "pdf",
        source: "reader",
        warnings: [],
      },
      createTextResult("", "empty", [
        "Attachment text is empty. The PDF may be unindexed or scanned.",
      ]),
    );

    const result = await registry.callTool("paper_read", {
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
    const registry = createRegistry(null);

    const result = await registry.callTool("paper_read", {
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
    const registry = createRegistry({
      attachmentItemID: 10,
      attachmentKey: "PDF",
      libraryID: 1,
      parentItemID: 20,
      readerItemID: 10,
      readerType: "pdf",
      source: "reader",
      warnings: [],
    });

    const result = await registry.callTool("paper_read", {
      question: "What is the method?",
    });

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "lexical retrieval");
    assert.notProperty(result, "structuredContent");
    assert.notInclude(JSON.stringify(result), "/tmp");
  });

  it("rejects unsupported paper_read input fields", async function () {
    const registry = createRegistry(null);

    try {
      await registry.callTool("paper_read", {
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

function createRegistry(
  scope: PaperScope | null = null,
  text = createTextResult("The method uses lexical retrieval."),
): McpToolRegistry {
  const registry = new McpToolRegistry();
  registry.register(
    createPaperReadTool({
      resolveActivePaper: async () => scope,
      readPaperText: async () => text,
    }),
  );
  return registry;
}

function createTextResult(
  text: string,
  status: PaperTextResult["status"] = "indexed",
  warnings: string[] = [],
): PaperTextResult {
  return {
    status,
    text,
    length: text.length,
    indexedState: 1,
    warnings,
  };
}
