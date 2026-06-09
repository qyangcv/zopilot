import { assert } from "chai";
import type { JsonValue } from "../../src/codex/types.ts";
import type { PaperScope, PaperTextResult } from "../../src/zotero/types.ts";
import { createMcpHttpHandler } from "../../src/mcp/httpServer.ts";
import { McpToolRegistry } from "../../src/mcp/toolRegistry.ts";
import { createPaperReadTool } from "../../src/mcp/tools/paperRead.ts";

const TOKEN = "test-token";

describe("MCP HTTP handler", function () {
  it("handles initialize, tools/list, and paper_read tools/call", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      registry: createRegistry({
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
        readerItemID: 10,
        readerType: "pdf",
        source: "reader",
        warnings: [],
      }),
    });

    const initialize = await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });
    const tools = await post(handler, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const call = await post(handler, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "paper_read",
        arguments: {
          question: "smoke method",
        },
      },
    });

    assert.equal(initialize.status, 200);
    assert.equal(readResult(initialize).serverInfo.name, "zotero-copilot");
    assert.deepEqual(
      readResult(tools).tools.map((tool: { name: string }) => tool.name),
      ["paper_read"],
    );
    assert.include(readResult(call).content[0].text, "smoke method snippet");
    assert.notProperty(readResult(call), "structuredContent");
    assert.isFalse(readResult(call).isError);
  });

  it("rejects requests without the bearer token", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      registry: createRegistry(null),
    });

    const response = await handler.handle({
      method: "POST",
      pathname: "/zotero-copilot/mcp",
      headers: {
        "Content-Type": "application/json",
        Host: "127.0.0.1:23119",
      },
      data: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    assert.equal(response.status, 403);
    assert.include(response.body || "", "Authorization");
  });

  it("returns a JSON-RPC error for unknown tools", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      registry: createRegistry(null),
    });

    const response = await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "paper_search",
        arguments: {},
      },
    });

    const body = JSON.parse(response.body || "{}");
    assert.equal(response.status, 200);
    assert.equal(body.error.code, -32602);
    assert.include(body.error.message, "Unknown MCP tool: paper_search");
  });
});

function createRegistry(scope: PaperScope | null): McpToolRegistry {
  const registry = new McpToolRegistry();
  registry.register(
    createPaperReadTool({
      resolveActivePaper: async () => scope,
      readPaperText: async () => createTextResult("A smoke method snippet."),
    }),
  );
  return registry;
}

async function post(
  handler: ReturnType<typeof createMcpHttpHandler>,
  body: JsonValue,
) {
  return handler.handle({
    method: "POST",
    pathname: "/zotero-copilot/mcp",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Host: "127.0.0.1:23119",
    },
    data: JSON.stringify(body),
  });
}

function readResult(response: { body?: string }): any {
  return JSON.parse(response.body || "{}").result;
}

function createTextResult(text: string): PaperTextResult {
  return {
    status: "indexed",
    text,
    length: text.length,
    indexedState: 1,
    warnings: [],
  };
}
