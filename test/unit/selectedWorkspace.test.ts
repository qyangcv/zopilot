import { assert } from "chai";
import {
  isLibraryTab,
  resolveSelectedWorkspace,
} from "../../src/integrations/zotero/selectedWorkspace.ts";

describe("selected Zotero workspace", function () {
  it("resolves the selected collection synchronously without an implicit paper source", function () {
    const result = resolveSelectedWorkspace(
      createWindow(createRow("collection")),
    );

    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.rowID, "C-COLL");
    assert.equal(result.workspace.workspaceKey, "collection:1:COLL");
    assert.isUndefined(result.workspace.defaultSource);
  });

  it("resolves library and group roots as library workspaces", function () {
    for (const type of ["library", "group"] as const) {
      const result = resolveSelectedWorkspace(createWindow(createRow(type)));
      assert.equal(result.status, "ready");
      if (result.status !== "ready") continue;
      assert.equal(result.workspace.workspaceKey, "library:1");
      assert.equal(result.workspace.workspaceLabel, "Research Library");
    }
  });

  it("keeps virtual collection rows unavailable instead of widening scope", function () {
    const result = resolveSelectedWorkspace(createWindow(createRow("search")));

    assert.equal(result.status, "unsupported");
  });

  it("recognizes the first Zotero tab as the library surface", function () {
    assert.isTrue(
      isLibraryTab({
        Zotero_Tabs: { selectedID: "zotero-pane", selectedType: "library" },
      } as unknown as Window),
    );
    assert.isFalse(
      isLibraryTab({
        Zotero_Tabs: { selectedID: "reader-1", selectedType: "reader" },
      } as unknown as Window),
    );
  });
});

function createWindow(row: ReturnType<typeof createRow>): Window {
  return {
    ZoteroPane: {
      getCollectionTreeRow: () => row,
    },
  } as unknown as Window;
}

function createRow(type: "collection" | "library" | "group" | "search") {
  return {
    id: type === "collection" ? "C-COLL" : `${type}-1`,
    ref: {
      key: type === "collection" ? "COLL" : undefined,
      libraryID: 1,
    },
    getName: () => "Research Library",
    isCollection: () => type === "collection",
    isLibrary: () => type === "library",
    isGroup: () => type === "group",
  };
}
