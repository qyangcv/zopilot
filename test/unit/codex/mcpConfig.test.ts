import { assert } from "chai";
import { buildCodexMcpServersConfig } from "../../../src/codex/mcpConfig.ts";
import {
  MCP_ENDPOINT_PATH,
  shutdownMcpHttpServer,
} from "../../../src/mcp/httpServer.ts";

type McpServerConfig = {
  url: string;
  enabled_tools: string[];
  http_headers: {
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
    const config = await buildCodexMcpServersConfig();
    const server = config["zotero-copilot"] as unknown as McpServerConfig;

    assert.equal(server.url, `http://127.0.0.1:23124${MCP_ENDPOINT_PATH}`);
    assert.deepEqual(server.enabled_tools, ["paper_read"]);
    assert.match(server.http_headers.Authorization, /^Bearer /);
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
