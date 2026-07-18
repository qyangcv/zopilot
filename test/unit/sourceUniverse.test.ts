import { assert } from "chai";
import { createItemWorkspaceIdentity } from "../../src/domain/conversation.ts";
import { ZoteroSourceUniverse } from "../../src/integrations/zotero/ZoteroWorkspaceService.ts";

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  title: string;
  deleted?: boolean;
  parentItemID?: number;
  date?: string;
  attachment?: boolean;
  pdf?: boolean;
  attachments?: number[];
  collections?: number[];
  isRegularItem?: () => boolean;
  isAnnotation?: () => boolean;
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isPDFAttachment?: () => boolean;
  getField?: (field: string) => string;
  getAttachments?: () => number[];
  getCollections?: () => number[];
  getCreatorsJSON?: () => Array<{ firstName: string; lastName: string }>;
};

type MockCollection = {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentID?: number;
  items: MockItem[];
  children: MockCollection[];
  getChildItems: () => MockItem[];
  getChildCollections: () => MockCollection[];
};

describe("ZoteroSourceUniverse", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("lists only library items with PDF attachments", async function () {
    const paper = createRegularItem(1, "AAA", "Paper A", [11]);
    const pdf = createAttachment(11, "PDF-A", true, paper.id);
    const noPdf = createRegularItem(2, "BBB", "Paper B", []);
    installZoteroMock([paper, pdf, noPdf], []);
    const universe = new ZoteroSourceUniverse();

    const sources = await universe.resolveSources({
      workspaceKey: "library:1",
      workspaceType: "library",
      workspaceLabel: "Library 1",
      workspaceTitle: "Library 1",
      libraryID: 1,
    });

    assert.deepEqual(
      sources.map((source) => [source.title, source.attachmentKey]),
      [["Paper A", "PDF-A"]],
    );
  });

  it("uses the Zotero library name for library workspaces", async function () {
    installZoteroMock([], [], "我的文库");
    const universe = new ZoteroSourceUniverse();

    const workspace = await universe.createLibraryWorkspace({ libraryID: 1 });

    assert.equal(workspace.workspaceLabel, "我的文库");
    assert.equal(workspace.workspaceTitle, "我的文库");
  });

  it("includes child collection items in collection workspaces", async function () {
    const parentPaper = createRegularItem(1, "AAA", "Parent Paper", [11]);
    const childPaper = createRegularItem(2, "BBB", "Child Paper", [21]);
    const parentCollection = createCollection(101, "COLL", "Collection", [
      parentPaper,
    ]);
    const childCollection = createCollection(102, "CHILD", "Child", [
      childPaper,
    ]);
    parentCollection.children.push(childCollection);
    childCollection.parentID = parentCollection.id;
    installZoteroMock(
      [
        parentPaper,
        childPaper,
        createAttachment(11, "PDF-A", true, parentPaper.id),
        createAttachment(21, "PDF-B", true, childPaper.id),
      ],
      [parentCollection, childCollection],
    );
    const universe = new ZoteroSourceUniverse();

    const sources = await universe.resolveSources({
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection",
      workspaceLabel: "Collection",
      workspaceTitle: "Collection",
      libraryID: 1,
      collectionKey: "COLL",
    });

    assert.sameMembers(
      sources.map((source) => source.title),
      ["Parent Paper", "Child Paper"],
    );
  });

  it("reads nested collection trees from object APIs with recursive deduplication", async function () {
    const parentPaper = createRegularItem(1, "AAA", "Parent Paper", [11]);
    const childPaper = createRegularItem(2, "BBB", "Child Paper", [21]);
    const parentCollection = createCollection(101, "COLL", "Collection", [
      parentPaper,
      childPaper,
    ]);
    const childCollection = createCollection(102, "CHILD", "Child", [
      childPaper,
    ]);
    parentCollection.children.push(childCollection);
    childCollection.parentID = parentCollection.id;
    installZoteroMock(
      [
        parentPaper,
        childPaper,
        createAttachment(11, "PDF-A", true, parentPaper.id),
        createAttachment(21, "PDF-B", true, childPaper.id),
      ],
      [parentCollection, childCollection],
    );
    const universe = new ZoteroSourceUniverse();

    const snapshot = await universe.getSnapshot({
      workspace: {
        workspaceKey: "library:1",
        workspaceType: "library",
        workspaceLabel: "Library 1",
        workspaceTitle: "Library 1",
        libraryID: 1,
      },
    });
    const sources = await universe.resolveSources({
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection",
      workspaceLabel: "Collection",
      workspaceTitle: "Collection",
      libraryID: 1,
      collectionKey: "COLL",
    });

    assert.deepEqual(
      snapshot.collections.map((collection) => ({
        key: collection.key,
        parentKey: collection.parentKey,
        hasChildren: collection.hasChildren,
        level: collection.level,
        itemCount: collection.itemCount,
      })),
      [
        {
          key: "COLL",
          parentKey: undefined,
          hasChildren: true,
          level: 0,
          itemCount: 2,
        },
        {
          key: "CHILD",
          parentKey: "COLL",
          hasChildren: false,
          level: 1,
          itemCount: 1,
        },
      ],
    );
    assert.equal(snapshot.libraryItemCount, 2);
    assert.sameMembers(
      sources.map((source) => source.title),
      ["Parent Paper", "Child Paper"],
    );
  });

  it("derives parent keys from object API collection relationships", async function () {
    const parent = createCollection(101, "COLL", "Collection", []);
    const child = createCollection(102, "CHILD", "Child", []);
    parent.children.push(child);
    child.parentID = parent.id;
    installZoteroMock([], [parent, child]);
    const universe = new ZoteroSourceUniverse();

    const snapshot = await universe.getSnapshot({
      workspace: {
        workspaceKey: "library:1",
        workspaceType: "library",
        workspaceLabel: "Library 1",
        workspaceTitle: "Library 1",
        libraryID: 1,
      },
    });

    assert.deepEqual(
      snapshot.collections.map((collection) => [
        collection.key,
        collection.parentKey,
        collection.hasChildren,
      ]),
      [
        ["COLL", undefined, true],
        ["CHILD", "COLL", false],
      ],
    );
  });

  it("prefers the active reader PDF for the current item", async function () {
    const paper = createRegularItem(1, "AAA", "Paper A", [11, 12]);
    installZoteroMock(
      [
        paper,
        createAttachment(11, "PDF-A", true, paper.id),
        createAttachment(12, "PDF-B", true, paper.id),
      ],
      [],
    );
    const workspace = createItemWorkspaceIdentity({
      paperKey: "1:AAA",
      libraryID: 1,
      parentItemID: 1,
      parentItemKey: "AAA",
      attachmentItemID: 12,
      attachmentKey: "PDF-B",
      title: "Paper A",
    });
    const universe = new ZoteroSourceUniverse();

    const sources = await universe.resolveSources(
      workspace,
      workspace.defaultSource,
    );

    assert.equal(sources[0]?.attachmentKey, "PDF-B");
  });

  it("matches Zotero library view semantics for child and standalone items", async function () {
    const paper = createRegularItem(1, "AAA", "Paper A", [11]);
    const childPdf = createAttachment(11, "PDF-A", true, paper.id);
    const childNote = createNote(12, "NOTE-A", paper.id);
    const annotation = createAnnotation(13, "ANNOTATION-A", childPdf.id);
    const standalonePdf = createAttachment(20, "PDF-STANDALONE", true);
    const standaloneNote = createNote(21, "NOTE-STANDALONE");
    const deletedPaper = {
      ...createRegularItem(30, "DELETED", "Deleted Paper", []),
      deleted: true,
    };
    installZoteroMock(
      [
        paper,
        childPdf,
        childNote,
        annotation,
        standalonePdf,
        standaloneNote,
        deletedPaper,
      ],
      [],
    );
    const universe = new ZoteroSourceUniverse();

    const snapshot = await universe.getSnapshot({
      workspace: {
        workspaceKey: "library:1",
        workspaceType: "library",
        workspaceLabel: "Library 1",
        workspaceTitle: "Library 1",
        libraryID: 1,
      },
    });

    assert.equal(snapshot.libraryItemCount, 3);
    assert.deepEqual(
      snapshot.sources.map((source) => source.title),
      ["Paper A"],
    );
  });

  it("scopes library counts and sources to the active library ID", async function () {
    const libraryOnePaper = createRegularItem(
      1,
      "LIB-ONE",
      "Library One Paper",
      [11],
      1,
    );
    const libraryFortyTwoPaper = createRegularItem(
      42,
      "LIB-FORTY-TWO",
      "Library Forty Two Paper",
      [142],
      42,
    );
    installZoteroMock(
      [
        libraryOnePaper,
        createAttachment(11, "PDF-ONE", true, libraryOnePaper.id, 1),
        libraryFortyTwoPaper,
        createAttachment(
          142,
          "PDF-FORTY-TWO",
          true,
          libraryFortyTwoPaper.id,
          42,
        ),
        createNote(143, "NOTE-FORTY-TWO", undefined, 42),
      ],
      [],
    );
    const universe = new ZoteroSourceUniverse();

    const snapshot = await universe.getSnapshot({
      workspace: {
        workspaceKey: "library:42",
        workspaceType: "library",
        workspaceLabel: "Library 42",
        workspaceTitle: "Library 42",
        libraryID: 42,
      },
    });

    assert.equal(snapshot.libraryItemCount, 2);
    assert.deepEqual(
      snapshot.sources.map((source) => source.title),
      ["Library Forty Two Paper"],
    );
  });
});

function createRegularItem(
  id: number,
  key: string,
  title: string,
  attachments: number[],
  libraryID = 1,
): MockItem {
  return {
    id,
    key,
    title,
    libraryID,
    attachments,
    isRegularItem: () => true,
    getField: (field) =>
      field === "title" ? title : field === "date" ? "2024" : "",
    getAttachments: () => attachments,
    getCollections: () => [],
    getCreatorsJSON: () => [{ firstName: "Ada", lastName: "Lovelace" }],
  };
}

function createAttachment(
  id: number,
  key: string,
  pdf: boolean,
  parentItemID?: number,
  libraryID = 1,
): MockItem {
  return {
    id,
    key,
    title: key,
    libraryID,
    parentItemID,
    attachment: true,
    pdf,
    isRegularItem: () => false,
    isAttachment: () => true,
    isPDFAttachment: () => pdf,
  };
}

function createNote(
  id: number,
  key: string,
  parentItemID?: number,
  libraryID = 1,
): MockItem {
  return {
    id,
    key,
    title: key,
    libraryID,
    parentItemID,
    isRegularItem: () => false,
    isNote: () => true,
  };
}

function createAnnotation(
  id: number,
  key: string,
  parentItemID: number,
  libraryID = 1,
): MockItem {
  return {
    id,
    key,
    title: key,
    libraryID,
    parentItemID,
    isRegularItem: () => false,
    isAnnotation: () => true,
  };
}

function createCollection(
  id: number,
  key: string,
  name: string,
  items: MockItem[],
): MockCollection {
  const collection: MockCollection = {
    id,
    key,
    name,
    libraryID: 1,
    items,
    children: [],
    getChildItems: () => collection.items,
    getChildCollections: () => collection.children,
  };
  return collection;
}

function installZoteroMock(
  items: MockItem[],
  collections: MockCollection[],
  libraryName = "Library 1",
): void {
  const itemById = new Map(items.map((item) => [item.id, item]));
  class MockSearch {
    readonly libraryID: number;
    private noChildren = false;

    constructor({ libraryID = 0 }: { libraryID?: number } = {}) {
      this.libraryID = libraryID;
    }

    addCondition(condition: string, operator: string): number {
      if (condition === "noChildren" && operator === "true") {
        this.noChildren = true;
      }
      return 1;
    }

    async search(): Promise<number[]> {
      if (!this.noChildren) {
        throw new Error("Expected the Zotero noChildren search condition");
      }
      return items
        .filter(
          (item) =>
            item.libraryID === this.libraryID &&
            !item.deleted &&
            item.parentItemID === undefined,
        )
        .map((item) => item.id);
    }
  }
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Search: MockSearch,
    Libraries: {
      getName: () => libraryName,
    },
    Items: {
      get: (id: number | string) =>
        typeof id === "number"
          ? itemById.get(id)
          : items.find((item) => item.key === id),
      getAsync: async (ids: number[]) =>
        ids.map((id) => itemById.get(id)).filter(Boolean),
      getAll: async () => {
        throw new Error("Items.getAll must not define library view semantics");
      },
    },
    Collections: {
      getByLibrary: () => collections,
      get: (id: number) =>
        collections.find((collection) => collection.id === id),
    },
  };
}
