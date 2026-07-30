import { assert } from "chai";
import { getZoteroItem } from "../../src/integrations/zotero/compat/items.ts";

describe("Zotero item compatibility", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("normalizes Zotero's false missing-item sentinel", function () {
    setItemsGet(() => false);

    assert.isUndefined(getZoteroItem(42));
  });

  it("returns an existing Zotero item unchanged", function () {
    const item = { id: 42 } as Zotero.Item;
    setItemsGet(() => item);

    assert.strictEqual(getZoteroItem(42), item);
  });
});

function setItemsGet(get: (itemID: number) => Zotero.Item | false): void {
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Items: { get },
  };
}
