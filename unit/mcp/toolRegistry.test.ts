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
    const output = result.structuredContent as any;

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "Zotero full-text snippet");
    assert.equal(output.status, "active_reader");
    assert.lengthOf(output.snippets, 1);
    assert.include(output.snippets[0].text, "retrieval augmented method");
    assert.equal(output.snippets[0].source, "zotero_fulltext");
    assert.deepInclude(output.snippets[0].locator, {
      chunkIndex: 0,
      charStart: 0,
    });
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
    const output = result.structuredContent as any;

    assert.isTrue(result.isError);
    assert.equal(output.status, "no_text");
    assert.isEmpty(output.snippets);
    assert.include(
      output.warnings,
      "No Zotero full-text evidence is available for the current PDF. The PDF may be scanned, unindexed, or unavailable locally.",
    );
  });

  it("returns no_active_reader when paper_read has no PDF reader scope", async function () {
    const registry = createRegistry(null);

    const result = await registry.callTool("paper_read", {
      question: "What is the method?",
    });
    const output = result.structuredContent as any;

    assert.isTrue(result.isError);
    assert.equal(output.status, "no_active_reader");
    assert.isEmpty(output.snippets);
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
    assert.deepInclude(result.structuredContent as object, {
      status: "active_reader",
    });
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
    preview: text,
    length: text.length,
    indexedState: 1,
    warnings,
  };
}
