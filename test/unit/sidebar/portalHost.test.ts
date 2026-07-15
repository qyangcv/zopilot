import { assert } from "chai";
import {
  resolveSidebarPortalHost,
  ZOTERO_PANE_STACK_ID,
} from "../../../src/features/sidebar/host/portalHost.ts";

describe("sidebar portal host", function () {
  it("uses the visible pane stack instead of the inactive Library tab", function () {
    const doc = new FakeDocument();
    const stack = new FakeElement(doc);
    const libraryTab = new FakeElement(doc, stack);
    const readerPanel = new FakeElement(doc, stack);
    doc.elements.set(ZOTERO_PANE_STACK_ID, stack);
    doc.elements.set("zotero-pane", libraryTab);

    assert.strictEqual(
      resolveSidebarPortalHost(readerPanel as unknown as Element),
      stack,
    );
    assert.notStrictEqual(
      resolveSidebarPortalHost(readerPanel as unknown as Element),
      libraryTab,
    );
  });

  it("rejects a stack that does not contain the active panel", function () {
    const doc = new FakeDocument();
    const stack = new FakeElement(doc);
    const detachedPanel = new FakeElement(doc);
    doc.elements.set(ZOTERO_PANE_STACK_ID, stack);

    assert.throws(
      () => resolveSidebarPortalHost(detachedPanel as unknown as Element),
      "overlay host",
    );
  });

  it("re-resolves the live stack after Zotero replaces its host subtree", function () {
    const doc = new FakeDocument();
    const initialStack = new FakeElement(doc);
    const initialPanel = new FakeElement(doc, initialStack);
    doc.elements.set(ZOTERO_PANE_STACK_ID, initialStack);

    assert.strictEqual(
      resolveSidebarPortalHost(initialPanel as unknown as Element),
      initialStack,
    );

    const replacementStack = new FakeElement(doc);
    const replacementPanel = new FakeElement(doc, replacementStack);
    doc.elements.set(ZOTERO_PANE_STACK_ID, replacementStack);

    assert.strictEqual(
      resolveSidebarPortalHost(replacementPanel as unknown as Element),
      replacementStack,
    );
  });
});

class FakeDocument {
  readonly elements = new Map<string, FakeElement>();

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) || null;
  }
}

class FakeElement {
  readonly isConnected = true;
  readonly ownerDocument: FakeDocument;

  constructor(
    doc: FakeDocument,
    readonly parentElement: FakeElement | null = null,
  ) {
    this.ownerDocument = doc;
  }

  contains(candidate: unknown): boolean {
    let current = candidate as FakeElement | null;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }
}
