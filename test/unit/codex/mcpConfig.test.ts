import { assert } from "chai";
import { buildCodexMcpServersConfig } from "../../../src/codex/mcpConfig.ts";
import type { ConversationMetadata } from "../../../src/shared/conversation.ts";
import {
  MCP_ENDPOINT_PATH,
  shutdownMcpHttpServer,
} from "../../../src/mcp/httpServer.ts";

type McpServerConfig = {
  url: string;
  enabled_tools: string[];
  http_headers: Record<string, string> & {
    Authorization: string;
  };
  startup_timeout_sec: number;
  tool_timeout_sec: number;
};

type ZoteroServerMock = {
  Prefs: {
    get(name: string): number | undefined;
  };
  Server: {
    Endpoint: new () => object;
    Endpoints: Record<string, unknown>;
  };
};

type TestGlobals = {
  Zotero?: ZoteroServerMock;
  ztoolkit?: {
    log: () => void;
  };
};

describe("Codex MCP config", function () {
  beforeEach(function () {
    installRuntimeMocks();
  });

  afterEach(function () {
    shutdownMcpHttpServer();
    delete getTestGlobals().Zotero;
    delete getTestGlobals().ztoolkit;
  });

  it("builds a thread/start mcp_servers config for paper_read", async function () {
    const config = await buildCodexMcpServersConfig(createConversation());
    const server = config["zopilot"] as unknown as McpServerConfig;

    assert.equal(server.url, `http://127.0.0.1:23124${MCP_ENDPOINT_PATH}`);
    assert.deepEqual(server.enabled_tools, ["paper_read"]);
    assert.match(server.http_headers.Authorization, /^Bearer /);
    assert.equal(server.http_headers["X-Zopilot-Conversation-ID"], "conv-a");
    assert.equal(server.http_headers["X-Zopilot-Paper-Key"], "1:PAPER-A");
    assert.equal(server.http_headers["X-Zopilot-Attachment-Item-ID"], "10");
    assert.equal(server.http_headers["X-Zopilot-Attachment-Key"], "PDF-A");
    assert.equal(server.http_headers["X-Zopilot-Library-ID"], "1");
    assert.equal(server.startup_timeout_sec, 10);
    assert.equal(server.tool_timeout_sec, 60);
    assert.property(
      getTestGlobals().Zotero?.Server.Endpoints || {},
      MCP_ENDPOINT_PATH,
    );
  });
});

function installRuntimeMocks(): void {
  const testGlobals = getTestGlobals();
  testGlobals.Zotero = {
    Prefs: {
      get: (name: string) => (name === "httpServer.port" ? 23124 : undefined),
    },
    Server: {
      Endpoint: class {},
      Endpoints: {},
    },
  };
  testGlobals.ztoolkit = {
    log: () => undefined,
  };
}

function getTestGlobals(): TestGlobals {
  return globalThis as unknown as TestGlobals;
}

function createConversation(): ConversationMetadata {
  return {
    id: "conv-a",
    scope: "paper",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    parentItemKey: "PAPER-A",
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
    label: "Paper A",
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
  };
}
