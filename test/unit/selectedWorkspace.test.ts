import { assert } from "chai";
import {
  isLibraryTab,
  resolveSelectedWorkspace,
} from "../../src/integrations/zotero/selectedWorkspace.ts";

describe("selected Zotero workspace", function () {
  it("resolves the selected collection without an implicit paper source", async function () {
    const result = await resolveSelectedWorkspace(
      createWindow(createRow("collection")),
      createFactory(),
    );

    assert.equal(result.status, "ready");
    if (result.status !== "ready") return;
    assert.equal(result.rowID, "C-COLL");
    assert.equal(result.workspace.workspaceKey, "collection:1:COLL");
    assert.isUndefined(result.workspace.defaultSource);
  });

  it("resolves library and group roots as library workspaces", async function () {
    for (const type of ["library", "group"] as const) {
      const result = await resolveSelectedWorkspace(
        createWindow(createRow(type)),
        createFactory(),
      );
      assert.equal(result.status, "ready");
      if (result.status !== "ready") continue;
      assert.equal(result.workspace.workspaceKey, "library:1");
      assert.equal(result.workspace.workspaceLabel, "Research Library");
    }
  });

  it("keeps virtual collection rows unavailable instead of widening scope", async function () {
    const result = await resolveSelectedWorkspace(
      createWindow(createRow("search")),
      createFactory(),
    );

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

function createFactory() {
  return {
    async createLibraryWorkspace(input: { libraryID: number; label?: string }) {
      return {
        workspaceKey: `library:${input.libraryID}`,
        workspaceType: "library" as const,
        libraryID: input.libraryID,
        workspaceLabel: input.label || "Library",
        workspaceTitle: input.label || "Library",
      };
    },
    async createCollectionWorkspace(input: {
      libraryID: number;
      collectionKey: string;
    }) {
      return {
        workspaceKey: `collection:${input.libraryID}:${input.collectionKey}`,
        workspaceType: "collection" as const,
        libraryID: input.libraryID,
        workspaceLabel: "Research Library",
        workspaceTitle: "Research Library",
        collectionKey: input.collectionKey,
      };
    },
  };
}
