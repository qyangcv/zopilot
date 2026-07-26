import { assert } from "chai";
import { installMcpWebRuntime } from "../../../src/integrations/mcp/webRuntime.ts";

describe("MCP Zotero web runtime", function () {
  let AbortControllerDescriptor: PropertyDescriptor | undefined;

  before(function () {
    AbortControllerDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "AbortController",
    );
  });

  afterEach(function () {
    delete (globalThis as { Zotero?: unknown }).Zotero;
    if (AbortControllerDescriptor) {
      Object.defineProperty(
        globalThis,
        "AbortController",
        AbortControllerDescriptor,
      );
    }
  });

  it("uses Zotero's native AbortController in the add-on sandbox", function () {
    class ZoteroAbortController {}
    Reflect.deleteProperty(globalThis, "AbortController");
    (globalThis as { Zotero?: unknown }).Zotero = {
      getMainWindow: () => ({
        AbortController: ZoteroAbortController,
      }),
    };

    installMcpWebRuntime();

    assert.strictEqual(globalThis.AbortController, ZoteroAbortController);
  });

  it("does not replace an existing AbortController", function () {
    class ExistingAbortController {}
    class ZoteroAbortController {}
    Object.defineProperty(globalThis, "AbortController", {
      configurable: true,
      value: ExistingAbortController,
      writable: true,
    });
    (globalThis as { Zotero?: unknown }).Zotero = {
      getMainWindow: () => ({
        AbortController: ZoteroAbortController,
      }),
    };

    installMcpWebRuntime();

    assert.strictEqual(globalThis.AbortController, ExistingAbortController);
  });
});
