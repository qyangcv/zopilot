import { assert } from "chai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  getAllMcpTools,
  MCPServerStreamableHttp,
  RunContext,
} from "@openai/agents";
import { PaperToolsService } from "../../../src/application/document/PaperToolsService.ts";
import type { ConversationMetadata } from "../../../src/domain/conversation.ts";
import type { Material, SourceIdentity } from "../../../src/document/types.ts";
import { createMcpHttpHandler } from "../../../src/integrations/mcp/httpServer.ts";
import { createPaperBindingHeaders } from "../../../src/integrations/mcp/workspaceBinding.ts";

const TOKEN = "test-token";
const MCP_URL = "http://127.0.0.1:23119/zopilot/mcp";
const TOOL_NAMES = ["get_outline", "search", "read", "view_page"];
const PDF_HASH = "ab".repeat(32);

describe("MCP HTTP handler", function () {
  it("runs the outline, search, read, and page-view flow through the official client", async function () {
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
    const outline = await client.callTool({
      name: "get_outline",
      arguments: {},
    });
    const outlineContent = outline.structuredContent as {
      rootLocator: string;
    };
    const read = await client.callTool({
      name: "read",
      arguments: { locator: outlineContent.rootLocator },
    });
    const search = await client.callTool({
      name: "search",
      arguments: { query: "reciprocal rank fusion" },
    });
    const page = await client.callTool({
      name: "view_page",
      arguments: { page: 2 },
    });
    await client.close();

    assert.deepEqual(
      tools.tools.map((tool) => tool.name),
      TOOL_NAMES,
    );
    assert.isFalse(outline.isError);
    assert.deepEqual(outline.content, []);
    assert.include(JSON.stringify(outline.structuredContent), "Methods");
    assert.isFalse(read.isError);
    assert.deepEqual(read.content, []);
    assert.include(
      JSON.stringify(read.structuredContent),
      "reciprocal rank fusion",
    );
    assert.isFalse(search.isError);
    assert.deepEqual(search.content, []);
    assert.include(JSON.stringify(search.structuredContent), "locator");
    assert.isUndefined(page.structuredContent);
    assert.equal(
      (page._meta?.["zopilot.viewPage"] as { page?: number } | undefined)?.page,
      2,
    );
    assert.equal(page.content[1].type, "image");
    if (page.content[1].type === "image") {
      assert.deepEqual(
        [...Buffer.from(page.content[1].data, "base64").subarray(0, 8)],
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    }
  });

  it("exposes the same four tool contracts to standard and Agents SDK clients", async function () {
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
      useStructuredContent: true,
    });

    try {
      await standard.connect(standardTransport);
      await agents.connect();
      const [standardTools, agentsTools, modelTools] = await Promise.all([
        standard.listTools(),
        agents.listTools(),
        getAllMcpTools([agents]),
      ]);
      const [standardResult, agentsResult] = await Promise.all([
        standard.callTool({ name: "get_outline", arguments: {} }),
        agents.callToolResult("get_outline", {}),
      ]);

      assert.deepEqual(
        standardTools.tools.map((tool) => tool.name),
        TOOL_NAMES,
      );
      assert.deepEqual(
        agentsTools.map((tool) => tool.name),
        TOOL_NAMES,
      );
      assert.isUndefined(
        standardTools.tools.find((tool) => tool.name === "view_page")
          ?.outputSchema,
      );
      assert.deepEqual(
        JSON.parse(JSON.stringify(standardResult)),
        JSON.parse(JSON.stringify(agentsResult)),
      );

      const outlineTool = modelTools.find(
        (tool) => tool.type === "function" && tool.name === "get_outline",
      );
      const viewPageTool = modelTools.find(
        (tool) => tool.type === "function" && tool.name === "view_page",
      );
      assert.equal(outlineTool?.type, "function");
      assert.equal(viewPageTool?.type, "function");
      if (
        outlineTool?.type !== "function" ||
        viewPageTool?.type !== "function"
      ) {
        throw new Error("Expected function tools.");
      }

      const outlineModelOutput = await outlineTool.invoke(
        new RunContext(),
        "{}",
      );
      assert.deepEqual(
        JSON.parse(String(outlineModelOutput)),
        standardResult.structuredContent,
      );

      const pageModelOutput = (await viewPageTool.invoke(
        new RunContext(),
        JSON.stringify({ page: 2 }),
      )) as unknown;
      assert.isArray(pageModelOutput);
      assert.equal(
        (pageModelOutput as Array<{ type?: string }>)[1]?.type,
        "image",
      );
    } finally {
      await Promise.all([
        standard.close().catch(() => undefined),
        agents.close().catch(() => undefined),
      ]);
    }
  });

  it("returns tool errors for missing bindings, invalid inputs, and unknown tools", async function () {
    const handler = createHandler();
    const unbound = await post(handler, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_outline", arguments: {} },
    });
    const invalid = await post(
      handler,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "view_page", arguments: { page: 0 } },
      },
      createPaperBindingHeaders(createConversation(), {
        acceptsImages: true,
      }),
    );
    const unknown = await post(handler, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "paper_read", arguments: {} },
    });

    assert.isTrue(readResult(unbound).isError);
    assertStandardToolError(invalid);
    assertStandardToolError(unknown);
  });

  it("rejects missing tokens, invalid hosts, and invalid origins", async function () {
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
    assert.notInclude(serialized, "iVBOR");
    assert.include(serialized, "mcp.http.response");
  });
});

function createHandler(
  overrides: Partial<Parameters<typeof createMcpHttpHandler>[0]> = {},
) {
  return createMcpHttpHandler({
    token: TOKEN,
    paperToolsService: createPaperToolsService(),
    readFile: async () =>
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    logger: () => undefined,
    url: MCP_URL,
    ...overrides,
  });
}

function createPaperToolsService(): PaperToolsService {
  const source = createSource();
  return new PaperToolsService({
    sourceUniverse: {
      async resolveSelectedPdfSources(_workspace, sourceIds) {
        return sourceIds.includes(source.sourceId) ? [createSourceRef()] : [];
      },
    },
    sourceResolver: {
      async resolveDefaultSource() {
        return source;
      },
      async resolveSourceRef() {
        return source;
      },
    },
    materialCache: {
      async getOrBuild() {
        return createMaterial(source);
      },
    },
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

function readResult(response: { body?: string }): {
  isError?: boolean;
} {
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

function createSource(): SourceIdentity {
  return {
    sourceId: "1-PDF-A",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
    filePath: "/tmp/paper-a.pdf",
    mtime: 1,
    size: 100,
    pdfHash: PDF_HASH,
  };
}

function createSourceRef() {
  return {
    sourceId: "1-PDF-A",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    parentItemID: 20,
    parentItemKey: "PAPER-A",
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
  };
}

function createMaterial(source: SourceIdentity): Material {
  return {
    dir: "/cache",
    manifest: {
      schemaVersion: 3,
      parser: "Zopilot PDF Helper/PyMuPDF4LLM",
      parserVersion: "test",
      source,
      builtAt: "2026-07-28T00:00:00.000Z",
      pageCount: 2,
      status: "ready",
      warnings: [],
    },
    markdown: "",
    text: "",
    pages: [
      { page: 1, text: "Introduction" },
      {
        page: 2,
        text: "Methods",
        imagePath: "/cache/page-0002.png",
      },
    ],
    blocks: [
      {
        id: "b-intro",
        page: 1,
        index: 0,
        type: "heading",
        text: "Introduction",
      },
      {
        id: "b-methods",
        page: 2,
        index: 0,
        type: "heading",
        text: "Methods",
      },
      {
        id: "b-method-text",
        page: 2,
        index: 1,
        type: "paragraph",
        text: "The method uses reciprocal rank fusion.",
      },
    ],
    outline: {
      status: "ready",
      provenance: "embedded",
      warnings: [],
      entries: [
        {
          id: "section-0001",
          title: "Introduction",
          level: 1,
          page: 1,
          blockId: "b-intro",
          provenance: "embedded",
        },
        {
          id: "section-0002",
          title: "Methods",
          level: 1,
          page: 2,
          blockId: "b-methods",
          provenance: "embedded",
        },
      ],
    },
    chunks: [
      {
        id: "chunk-000001",
        sourceId: source.sourceId,
        index: 0,
        kind: "body",
        title: "Methods",
        sectionPath: ["Methods"],
        pageStart: 2,
        pageEnd: 2,
        text: "The method uses reciprocal rank fusion.",
        blockIds: ["b-method-text"],
        artifactIds: [],
      },
    ],
    artifacts: [],
  };
}
