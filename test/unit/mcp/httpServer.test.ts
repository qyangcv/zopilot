import { assert } from "chai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCPServerStreamableHttp } from "@openai/agents";
import type { ConversationMetadata } from "../../../src/domain/conversation.ts";
import type { BuiltContext } from "../../../src/document/types.ts";
import { PaperReadService } from "../../../src/application/document/PaperReadService.ts";
import { createMcpHttpHandler } from "../../../src/integrations/mcp/httpServer.ts";
import { createPaperBindingHeaders } from "../../../src/integrations/mcp/workspaceBinding.ts";

const TOKEN = "test-token";
const MCP_URL = "http://127.0.0.1:23119/zopilot/mcp";

describe("MCP HTTP handler", function () {
  it("works through the official client initialize, list, and call flow", async function () {
    const handler = createHandler();
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...createPaperBindingHeaders(createConversation(), {
            acceptsImages: true,
          }),
        },
      },
      fetch: createHandlerFetch(handler),
    });
    const client = new Client({ name: "zopilot-test", version: "1.0.0" });

    await client.connect(transport);
    const tools = await client.listTools();
    const result = await client.callTool({
      name: "paper_read",
      arguments: { question: "Explain Figure 2" },
    });
    await client.close();

    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      ["paper_read"],
    );
    assert.isFalse(result.isError);
    assert.equal(result.structuredContent?.status, "ready");
    assert.equal(result.content[0].type, "text");
    assert.include(
      result.content[0].type === "text" ? result.content[0].text : "",
      "page=5",
    );
    assert.equal(result.content[1].type, "image");
    if (result.content[1].type === "image") {
      assert.deepEqual(
        [...Buffer.from(result.content[1].data, "base64").subarray(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    }
  });

  it("returns the same contract to the standard and Agents SDK clients", async function () {
    const handler = createHandler();
    const headers = {
      Authorization: `Bearer ${TOKEN}`,
      ...createPaperBindingHeaders(createConversation(), {
        acceptsImages: true,
      }),
    };
    const standardTransport = new StreamableHTTPClientTransport(
      new URL(MCP_URL),
      {
        requestInit: { headers },
        fetch: createHandlerFetch(handler),
      },
    );
    const standard = new Client({
      name: "codex-contract-test",
      version: "1.0.0",
    });
    const agents = new MCPServerStreamableHttp({
      name: "zopilot",
      url: MCP_URL,
      requestInit: { headers },
      fetch: createHandlerFetch(handler),
    });

    try {
      await standard.connect(standardTransport);
      await agents.connect();
      const [standardTools, agentsTools] = await Promise.all([
        standard.listTools(),
        agents.listTools(),
      ]);
      const [standardResult, agentsResult] = await Promise.all([
        standard.callTool({
          name: "paper_read",
          arguments: { question: "Explain Figure 2" },
        }),
        agents.callToolResult("paper_read", {
          question: "Explain Figure 2",
        }),
      ]);

      assert.deepEqual(
        standardTools.tools.map((tool) => tool.name),
        agentsTools.map((tool) => tool.name),
      );
      assert.deepEqual(
        JSON.parse(JSON.stringify(standardResult)),
        JSON.parse(JSON.stringify(agentsResult)),
      );
    } finally {
      await Promise.all([
        standard.close().catch(() => undefined),
        agents.close().catch(() => undefined),
      ]);
    }
  });

  it("rejects missing token, invalid host, and invalid origin", async function () {
    const handler = createHandler();
    for (const headers of [
      { Host: "127.0.0.1:23119" },
      {
        Host: "evil.example",
        Authorization: `Bearer ${TOKEN}`,
      },
      {
        Host: "127.0.0.1:23119",
        Origin: "https://evil.example",
        Authorization: `Bearer ${TOKEN}`,
      },
    ]) {
      const response = await handler.handle({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...headers,
        },
        data: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      assert.equal(response.status, 403);
    }
  });

  it("returns standard tool errors for missing binding and image failures", async function () {
    const handler = createHandler({
      readFile: async () => {
        throw new Error("missing image");
      },
    });
    const unbound = await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "paper_read", arguments: {} },
    });
    const bound = await post(
      handler,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "paper_read",
          arguments: { question: "Figure 2" },
        },
      },
      createPaperBindingHeaders(createConversation(), {
        acceptsImages: true,
      }),
    );

    assert.isTrue(readResult(unbound).isError);
    assert.isFalse(readResult(bound).isError);
    assert.lengthOf(readResult(bound).content, 1);
    assert.include(
      JSON.stringify(readResult(bound).structuredContent),
      "Could not read the page image",
    );
  });

  it("does not leak bearer tokens or image data to logs", async function () {
    const logs: unknown[] = [];
    const handler = createHandler({
      logger: (message, details) => logs.push({ message, details }),
    });
    await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const serialized = JSON.stringify(logs);
    assert.notInclude(serialized, TOKEN);
    assert.notInclude(serialized, "aW1hZ2U=");
    assert.include(serialized, "mcp.http.response");
  });

  it("returns standard errors for invalid JSON, arguments, and tool names", async function () {
    const handler = createHandler();
    const invalidJson = await handler.handle({
      method: "POST",
      headers: requestHeaders(),
      data: "{",
    });
    const invalidArguments = await post(handler, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "paper_read",
        arguments: {
          sourceIds: Array.from(
            { length: 11 },
            (_, index) => `source-${index}`,
          ),
        },
      },
    });
    const unknownTool = await post(handler, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "paper_search", arguments: {} },
    });

    assert.equal(invalidJson.status, 400);
    assertStandardToolError(invalidArguments);
    assertStandardToolError(unknownTool);
  });

  it("isolates concurrent requests that reuse the same JSON-RPC id", async function () {
    const handler = createMcpHttpHandler({
      token: TOKEN,
      url: MCP_URL,
      logger: () => undefined,
      paperReadService: new PaperReadService({
        contextBuilder: {
          async build(input) {
            return createContext(true, input.question || "");
          },
        },
      }),
    });
    const headers = createPaperBindingHeaders(createConversation());
    const [first, second] = await Promise.all([
      callPaper(handler, 7, "first question", headers),
      callPaper(handler, 7, "second question", headers),
    ]);

    assert.include(JSON.stringify(readResult(first)), "first question");
    assert.notInclude(JSON.stringify(readResult(first)), "second question");
    assert.include(JSON.stringify(readResult(second)), "second question");
  });
});

function createHandler(
  overrides: Partial<Parameters<typeof createMcpHttpHandler>[0]> = {},
) {
  return createMcpHttpHandler({
    token: TOKEN,
    paperReadService: new PaperReadService({
      contextBuilder: {
        async build(input) {
          return createContext(Boolean(input.scope));
        },
      },
    }),
    readFile: async () =>
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    logger: () => undefined,
    url: MCP_URL,
    ...overrides,
  });
}

function createHandlerFetch(
  handler: ReturnType<typeof createMcpHttpHandler>,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = Object.fromEntries(request.headers.entries());
    headers.Host = new URL(request.url).host;
    const response = await handler.handle({
      method: request.method,
      headers,
      data:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.text(),
    });
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

async function post(
  handler: ReturnType<typeof createMcpHttpHandler>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return handler.handle({
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Host: "127.0.0.1:23119",
      ...headers,
    },
    data: JSON.stringify(body),
  });
}

function callPaper(
  handler: ReturnType<typeof createMcpHttpHandler>,
  id: number,
  question: string,
  headers: Record<string, string>,
) {
  return post(
    handler,
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: "paper_read", arguments: { question } },
    },
    headers,
  );
}

function requestHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Host: "127.0.0.1:23119",
  };
}

function readResult(response: { body?: string }): any {
  return JSON.parse(response.body || "{}").result;
}

function assertStandardToolError(response: { body?: string }): void {
  const body = JSON.parse(response.body || "{}");
  assert.isTrue(body.error?.code === -32602 || body.result?.isError === true);
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
  bound: boolean,
  evidenceText = "Figure 2 result.",
): BuiltContext {
  return {
    status: bound ? "ready" : "not_bound",
    workspace: {
      key: "item:1:PAPER-A",
      type: "item",
      label: "Paper A",
    },
    sources: bound
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
      query: "Figure 2",
      intent: "figure",
      locator: { type: "figure", value: "2" },
      includeReferences: false,
    },
    evidence: bound
      ? [
          {
            type: "artifact",
            sourceId: "1-PDF-A",
            artifactId: "figure-2",
            page: 5,
            sectionPath: ["Results"],
            score: 1,
            reasons: ["exact artifact locator"],
            text: evidenceText,
            imagePath: "/cache/page-5.png",
          },
        ]
      : [],
    warnings: bound
      ? []
      : ["This Codex thread is not bound to a Zotero paper."],
  };
}
