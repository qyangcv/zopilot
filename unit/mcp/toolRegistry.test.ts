import { assert } from "chai";
import type { PaperScope } from "../../src/zotero/types.ts";
import { McpToolRegistry } from "../../src/mcp/toolRegistry.ts";
import { createPaperReadTool } from "../../src/mcp/tools/paperRead.ts";

describe("McpToolRegistry", function () {
  it("lists only paper_read for Step 5.1", function () {
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

  it("calls paper_read and returns active reader scope status", async function () {
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
      maxChars: 10,
    });

    assert.isFalse(result.isError);
    assert.include(result.content[0].text, "Step 5.1 skeleton is reachable");
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

function createRegistry(scope: PaperScope | null = null): McpToolRegistry {
  const registry = new McpToolRegistry();
  registry.register(
    createPaperReadTool({
      resolveActivePaper: async () => scope,
    }),
  );
  return registry;
}
