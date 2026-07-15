import { assert } from "chai";
import { ZoteroServerEndpointRegistry } from "../../../src/integrations/zotero/compat/serverEndpointRegistry.ts";

describe("ZoteroServerEndpointRegistry", function () {
  afterEach(function () {
    delete (globalThis as { Zotero?: unknown }).Zotero;
  });

  it("rejects an endpoint path owned by another constructor", function () {
    class Existing {}
    class Zopilot {}
    installEndpoints({ "/zopilot/mcp": Existing });
    const registry = new ZoteroServerEndpointRegistry();

    const result = registry.register("/zopilot/mcp", Zopilot);

    assert.deepInclude(result, { ok: false, code: "path_conflict" });
    assert.strictEqual(readEndpoints()["/zopilot/mcp"], Existing);
  });

  it("is idempotent and only unregisters the constructor it owns", function () {
    class Zopilot {}
    class Replacement {}
    installEndpoints({});
    const registry = new ZoteroServerEndpointRegistry();

    assert.deepEqual(registry.register("/zopilot/mcp", Zopilot), {
      ok: true,
      alreadyRegistered: false,
    });
    assert.deepEqual(registry.register("/zopilot/mcp", Zopilot), {
      ok: true,
      alreadyRegistered: true,
    });
    readEndpoints()["/zopilot/mcp"] = Replacement;

    assert.isFalse(registry.unregister());
    assert.strictEqual(readEndpoints()["/zopilot/mcp"], Replacement);
  });
});

function installEndpoints(endpoints: Record<string, unknown>): void {
  (globalThis as { Zotero?: unknown }).Zotero = {
    Server: { Endpoints: endpoints },
  };
}

function readEndpoints(): Record<string, unknown> {
  return (
    globalThis as unknown as {
      Zotero: { Server: { Endpoints: Record<string, unknown> } };
    }
  ).Zotero.Server.Endpoints;
}
