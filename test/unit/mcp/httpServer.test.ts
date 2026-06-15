import { assert } from "chai";
import type { JsonValue } from "../../../src/codex/types.ts";
import type { PaperScope } from "../../../src/zotero/types.ts";
import { createMcpHttpHandler } from "../../../src/mcp/httpServer.ts";
import { createPaperReadTool } from "../../../src/mcp/tools/paperRead.ts";

const TOKEN = "test-token";

type JsonRpcTestResponse<T> = {
  result: T;
  error?: {
    code?: number;
    message?: string;
  };
};

type InitializeResult = {
  serverInfo: {
    name: string;
  };
};

type ToolsListResult = {
  tools: Array<{
    name: string;
  }>;
};

type ToolCallResult = {
  content: Array<{
    type: string;
    text: string;
  }>;
  structuredContent?: unknown;
  isError?: boolean;
};

describe("MCP HTTP handler", function () {
  it("handles initialize, tools/list, and paper_read tools/call", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      paperReadTool: createTool({
        attachmentItemID: 10,
        attachmentKey: "PDF",
        libraryID: 1,
        parentItemID: 20,
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
    assert.equal(
      readResult<InitializeResult>(initialize).serverInfo.name,
      "zopilot",
    );
    assert.deepEqual(
      readResult<ToolsListResult>(tools).tools.map((tool) => tool.name),
      ["paper_read"],
    );
    const callResult = readResult<ToolCallResult>(call);
    assert.include(callResult.content[0].text, "smoke method snippet");
    assert.notProperty(callResult, "structuredContent");
    assert.isFalse(callResult.isError);
  });

  it("rejects requests without the bearer token", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      paperReadTool: createTool(null),
      logger: () => undefined,
    });

    const response = await handler.handle({
      method: "POST",
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
      paperReadTool: createTool(null),
      logger: () => undefined,
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

  it("keeps supporting an injected logger callback", async function () {
    const logs: Array<{ message: string; details?: JsonValue }> = [];
    const handler = createMcpHttpHandler({
      token: TOKEN,
      paperReadTool: createTool(null),
      logger: (message, details) => logs.push({ message, details }),
    });

    await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    });

    assert.include(
      logs.map((entry) => entry.message),
      "mcp.http.request",
    );
    assert.include(
      logs.map((entry) => entry.message),
      "mcp.http.response",
    );
  });
});

function createTool(scope: PaperScope | null) {
  return createPaperReadTool({
    resolveActivePaper: async () => scope,
    readPaperText: async () => "A smoke method snippet.",
  });
}

async function post(
  handler: ReturnType<typeof createMcpHttpHandler>,
  body: JsonValue,
) {
  return handler.handle({
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Host: "127.0.0.1:23119",
    },
    data: JSON.stringify(body),
  });
}

function readResult<T>(response: { body?: string }): T {
  return (JSON.parse(response.body || "{}") as JsonRpcTestResponse<T>).result;
}
