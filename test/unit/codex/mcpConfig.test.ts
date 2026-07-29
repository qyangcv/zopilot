import { assert } from "chai";
import { buildCodexMcpServersConfig } from "../../../src/integrations/codex/mcpConfig.ts";
import type { ThreadRunInput } from "../../../src/domain/thread.ts";
import {
  MCP_ENDPOINT_PATH,
  shutdownMcpHttpServer,
} from "../../../src/integrations/mcp/httpServer.ts";

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
};

describe("Codex MCP config", function () {
  beforeEach(function () {
    installRuntimeMocks();
  });

  afterEach(function () {
    shutdownMcpHttpServer();
    delete getTestGlobals().Zotero;
  });

  it("enables the four Zopilot paper tools", async function () {
    const config = await buildCodexMcpServersConfig(createRun());
    const server = config["zopilot"] as unknown as McpServerConfig;

    assert.equal(server.url, `http://127.0.0.1:23124${MCP_ENDPOINT_PATH}`);
    assert.deepEqual(server.enabled_tools, [
      "get_outline",
      "search",
      "read",
      "view_page",
    ]);
    assert.match(server.http_headers.Authorization, /^Bearer /);
    assert.equal(server.http_headers["X-Zopilot-Conversation-ID"], "conv-a");
    assert.equal(
      server.http_headers["X-Zopilot-Workspace-Key"],
      "item:1:PAPER-A",
    );
    assert.equal(server.http_headers["X-Zopilot-Workspace-Type"], "item");
    assert.equal(server.http_headers["X-Zopilot-Workspace-Label"], "Paper A");
    assert.deepEqual(
      JSON.parse(server.http_headers["X-Zopilot-Thread-Sources"]),
      createRun().context.sources,
    );
    assert.equal(server.http_headers["X-Zopilot-Primary-Source-ID"], "1-PDF-A");
    assert.equal(server.http_headers["X-Zopilot-Library-ID"], "1");
    assert.equal(server.startup_timeout_sec, 10);
    assert.equal(server.tool_timeout_sec, 60);
    assert.property(
      getTestGlobals().Zotero?.Server.Endpoints || {},
      MCP_ENDPOINT_PATH,
    );
  });

  it("disables only MCP when the Zotero endpoint path is already owned", async function () {
    class ExistingEndpoint {}
    getTestGlobals().Zotero!.Server.Endpoints[MCP_ENDPOINT_PATH] =
      ExistingEndpoint;

    const config = await buildCodexMcpServersConfig(createRun());

    assert.deepEqual(config, {});
    assert.strictEqual(
      getTestGlobals().Zotero!.Server.Endpoints[MCP_ENDPOINT_PATH],
      ExistingEndpoint,
    );
  });

  it("disables only MCP when endpoint initialization throws", async function () {
    getTestGlobals().Zotero!.Prefs.get = () => {
      throw new Error("HTTP server preferences unavailable");
    };

    const config = await buildCodexMcpServersConfig(createRun());

    assert.deepEqual(config, {});
    assert.notProperty(
      getTestGlobals().Zotero!.Server.Endpoints,
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
}

function getTestGlobals(): TestGlobals {
  return globalThis as unknown as TestGlobals;
}

function createRun(): ThreadRunInput {
  return {
    threadId: "conv-a",
    turnId: "turn-a",
    sequence: 1,
    prompt: "Question",
    history: [],
    providerProfileId: "codex-cli.default",
    workspace: {
      id: "conv-a",
      workspaceKey: "item:1:PAPER-A",
      workspaceType: "item",
      workspaceLabel: "Paper A",
      workspaceTitle: "Paper A",
      libraryID: 1,
      itemKey: "PAPER-A",
    },
    context: {
      sources: [
        {
          sourceId: "1-PDF-A",
          paperKey: "1:PAPER-A",
          libraryID: 1,
          parentItemKey: "PAPER-A",
          attachmentItemID: 10,
          attachmentKey: "PDF-A",
          title: "Paper A",
        },
      ],
      selectedSources: [],
      primarySourceId: "1-PDF-A",
      noteContexts: [],
      localAttachments: [],
    },
  };
}
