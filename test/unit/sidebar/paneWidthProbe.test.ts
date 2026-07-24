import { assert } from "chai";
import { ContextPaneDeckAdapter } from "../../../src/features/sidebar/host/ContextPaneAdapter.ts";
import { LibraryItemPaneAdapter } from "../../../src/features/sidebar/host/LibraryItemPaneAdapter.ts";
import { probeContextPane } from "../../../src/features/sidebar/host/contextPaneProbe.ts";
import { probeLibraryItemPane } from "../../../src/features/sidebar/host/libraryItemPaneProbe.ts";

describe("sidebar pane width capability probes", function () {
  it("exposes a standard Reader width target only when its siblings match", function () {
    const fixture = createReaderDocument();
    const adapter = new ContextPaneDeckAdapter({
      document: fixture.doc,
    } as Window);

    const target = adapter.getPaneWidthTarget();

    assert.strictEqual(target?.pane, fixture.contextPane);
    assert.strictEqual(target?.sibling, fixture.tabsDeck);
    assert.strictEqual(target?.splitter, fixture.splitter);
    assert.isTrue(target?.standard);
  });

  it("keeps the Reader host available when width-only nodes are missing", function () {
    const fixture = createReaderDocument();
    fixture.selectors.delete("#tabs-deck");

    const probe = probeContextPane(fixture.doc);

    assert.isTrue(probe.available);
    if (probe.available) assert.isUndefined(probe.widthCapability);
  });

  it("exposes Library sizing only for the horizontal layout switcher", function () {
    const fixture = createLibraryDocument();
    const adapter = new LibraryItemPaneAdapter({
      document: fixture.doc,
    } as Window);

    assert.isTrue(adapter.getPaneWidthTarget()?.standard);

    fixture.layoutSwitcher.setAttribute("orient", "vertical");
    assert.isFalse(adapter.getPaneWidthTarget()?.standard);
  });

  it("keeps the Library host available when sizing relationships change", function () {
    const fixture = createLibraryDocument();
    fixture.itemsPane.parentElement = node();

    const probe = probeLibraryItemPane(fixture.doc);

    assert.isTrue(probe.available);
    if (probe.available) assert.isUndefined(probe.widthCapability);
  });
});

type FakeNode = Element & {
  selectedIndex?: number;
  parentElement: FakeNode | null;
};

function createReaderDocument() {
  const parent = node();
  const contextPane = node(parent, ["standard"]);
  const tabsDeck = node(parent);
  const splitter = node(parent);
  splitter.setAttribute("orient", "horizontal");
  const deck = node();
  deck.selectedIndex = 0;
  const notesDeck = node(deck);
  const sidenav = node();
  const notesButton = node();
  sidenav.querySelector = (() => notesButton) as typeof sidenav.querySelector;
  const selectors = new Map<string, FakeNode>([
    ["#zotero-context-pane", contextPane],
    ["#zotero-context-pane-inner", node()],
    ["#zotero-context-pane-deck", deck],
    ["#zotero-context-pane-item-deck", node()],
    ["#zotero-context-pane-notes-deck", notesDeck],
    ["#zotero-context-pane-sidenav", sidenav],
    ['[data-pane="context-notes"]', notesButton],
    ["#tabs-deck", tabsDeck],
    ["#zotero-context-splitter", splitter],
  ]);
  return {
    doc: documentFrom(selectors),
    selectors,
    contextPane,
    tabsDeck,
    splitter,
  };
}

function createLibraryDocument() {
  const layoutSwitcher = node();
  layoutSwitcher.setAttribute("orient", "horizontal");
  const itemsPane = node(layoutSwitcher);
  const splitter = node(layoutSwitcher);
  splitter.setAttribute("orient", "horizontal");
  const itemPane = node(layoutSwitcher);
  const deck = node();
  deck.selectedIndex = 0;
  const selectors = new Map<string, FakeNode>([
    ["#zotero-item-pane", itemPane],
    ["#zotero-item-pane-content", deck],
    ["#zotero-view-item-sidenav", node()],
    ["#zotero-layout-switcher", layoutSwitcher],
    ["#zotero-items-pane-container", itemsPane],
    ["#zotero-items-splitter", splitter],
  ]);
  return {
    doc: documentFrom(selectors),
    itemPane,
    itemsPane,
    splitter,
    layoutSwitcher,
  };
}

function documentFrom(selectors: Map<string, FakeNode>): Document {
  return {
    querySelector: (selector: string) => selectors.get(selector) || null,
  } as Document;
}

function node(
  parent: FakeNode | null = null,
  classes: string[] = [],
): FakeNode {
  const attributes = new Map<string, string>();
  const classNames = new Set(classes);
  return {
    parentElement: parent,
    classList: {
      contains: (name: string) => classNames.has(name),
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    querySelector: () => null,
  } as unknown as FakeNode;
}
