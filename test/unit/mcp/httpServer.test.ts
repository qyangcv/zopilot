import { assert } from "chai";
import type { JsonValue } from "../../../src/codex/types.ts";
import type { ConversationMetadata } from "../../../src/shared/conversation.ts";
import { createMcpHttpHandler } from "../../../src/mcp/httpServer.ts";
import { createPaperBindingHeaders } from "../../../src/mcp/paperBinding.ts";
import { createPaperReadTool } from "../../../src/mcp/tools/paperRead.ts";
import type { BuiltContext } from "../../../src/document/types.ts";

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
      paperReadTool: createTool(),
    });
    const bindingHeaders = createPaperBindingHeaders(createConversation());

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
    const call = await post(
      handler,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "paper_read",
          arguments: {
            question: "smoke method",
          },
        },
      },
      bindingHeaders,
    );

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
      paperReadTool: createTool(),
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
      paperReadTool: createTool(),
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
      paperReadTool: createTool(),
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

  it("returns a tool error when paper_read is called without paper binding headers", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      paperReadTool: createTool(),
      logger: () => undefined,
    });

    const response = await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "paper_read",
        arguments: {
          question: "smoke method",
        },
      },
    });

    const result = readResult<ToolCallResult>(response);
    assert.equal(response.status, 200);
    assert.isTrue(result.isError);
    assert.include(result.content[0].text, "not bound to a Zotero paper");
  });
});

function createTool() {
  return createPaperReadTool({
    contextBuilder: {
      async build(input) {
        return createContext(
          input.scope
            ? `${input.scope.defaultSource?.attachmentKey} smoke method snippet.`
            : "smoke method snippet.",
          input.scope ? "ready" : "not_bound",
        );
      },
    },
  });
}

async function post(
  handler: ReturnType<typeof createMcpHttpHandler>,
  body: JsonValue,
  headers: Record<string, string> = {},
) {
  return handler.handle({
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Host: "127.0.0.1:23119",
      ...headers,
    },
    data: JSON.stringify(body),
  });
}

function readResult<T>(response: { body?: string }): T {
  return (JSON.parse(response.body || "{}") as JsonRpcTestResponse<T>).result;
}

function createConversation(): ConversationMetadata {
  return {
    id: "conv-a",
    scope: "workspace",
    workspaceKey: "item:1:PAPER-A",
    workspaceType: "item",
    workspaceLabel: "Paper A",
    workspaceTitle: "Paper A",
    libraryID: 1,
    defaultSource: {
      paperKey: "1:PAPER-A",
      libraryID: 1,
      parentItemKey: "PAPER-A",
      attachmentItemID: 10,
      attachmentKey: "PDF-A",
      title: "Paper A",
    },
    label: "Paper A",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  };
}

function createContext(
  text: string,
  status: BuiltContext["status"],
): BuiltContext {
  return {
    status,
    workspace: {
      key: "item:1:PAPER-A",
      type: "item",
      label: "Paper A",
    },
    sources:
      status === "ready"
        ? [
            {
              sourceId: "1-PDF-A",
              paperKey: "1:PAPER-A",
              libraryID: 1,
              attachmentItemID: 10,
              attachmentKey: "PDF-A",
              title: "Paper A",
              filePath: "/tmp/paper.pdf",
              mtime: 1,
              size: 1024,
              pdfHash: "hash",
            },
          ]
        : [],
    query: {
      query: "smoke method",
      intent: "general",
      includeReferences: false,
    },
    evidence:
      status === "ready"
        ? [
            {
              type: "chunk",
              sourceId: "1-PDF-A",
              chunkId: "1-PDF-A:chunk:1",
              page: 2,
              sectionPath: ["Method"],
              score: 1,
              reasons: ["body search"],
              text,
            },
          ]
        : [],
    warnings:
      status === "not_bound"
        ? ["This Codex thread is not bound to a Zotero paper."]
        : [],
  };
}
