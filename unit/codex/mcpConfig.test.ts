import { assert } from "chai";
import { buildCodexMcpServersConfig } from "../../src/codex/mcpConfig.ts";
import {
  MCP_ENDPOINT_PATH,
  shutdownMcpHttpServer,
} from "../../src/mcp/httpServer.ts";

describe("Codex MCP config", function () {
  let originalFetch: typeof fetch;

  before(function () {
    originalFetch = globalThis.fetch;
  });

  beforeEach(function () {
    installRuntimeMocks();
  });

  afterEach(function () {
    shutdownMcpHttpServer();
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
    delete (globalThis as unknown as { ztoolkit?: unknown }).ztoolkit;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it("builds a thread/start mcp_servers config for paper_read", async function () {
    const config = await buildCodexMcpServersConfig();
    const server = config["zotero-copilot"] as any;

    assert.equal(server.url, `http://127.0.0.1:23124${MCP_ENDPOINT_PATH}`);
    assert.deepEqual(server.enabled_tools, ["paper_read"]);
    assert.match(server.http_headers.Authorization, /^Bearer /);
    assert.equal(server.startup_timeout_sec, 10);
    assert.equal(server.tool_timeout_sec, 60);
    assert.property(
      (globalThis as any).Zotero.Server.Endpoints as object,
      MCP_ENDPOINT_PATH,
    );
  });
});

function installRuntimeMocks(): void {
  (globalThis as any).Zotero = {
    Prefs: {
      get: (name: string) => (name === "httpServer.port" ? 23124 : undefined),
    },
    Server: {
      Endpoint: class {},
      Endpoints: {},
    },
  };
  (globalThis as any).ztoolkit = {
    log: () => undefined,
  };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = async () =>
    ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {},
        }),
    }) as Response;
}
