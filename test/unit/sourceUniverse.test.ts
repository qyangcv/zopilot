import { assert } from "chai";
import { createItemWorkspaceIdentity } from "../../src/domain/conversation.ts";
import { ZoteroSourceUniverse } from "../../src/integrations/zotero/ZoteroWorkspaceService.ts";

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  title: string;
  date?: string;
  attachment?: boolean;
  pdf?: boolean;
  attachments?: number[];
  collections?: number[];
  isRegularItem?: () => boolean;
  isAttachment?: () => boolean;
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
    const pdf = createAttachment(11, "PDF-A", true);
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
        createAttachment(11, "PDF-A", true),
        createAttachment(21, "PDF-B", true),
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

  it("reads collection trees and collection items from Zotero DB", async function () {
    const parentPaper = createRegularItem(1, "AAA", "Parent Paper", [11]);
    const childPaper = createRegularItem(2, "BBB", "Child Paper", [21]);
    installZoteroMock(
      [
        parentPaper,
        childPaper,
        createAttachment(11, "PDF-A", true),
        createAttachment(21, "PDF-B", true),
      ],
      [],
      "Library 1",
      {
        collections: [
          {
            id: 101,
            key: "COLL",
            libraryID: 1,
            name: "Collection",
          },
          {
            id: 102,
            key: "CHILD",
            libraryID: 1,
            name: "Child",
            parentID: 101,
          },
        ],
        collectionItems: new Map([
          ["COLL", [1, 2]],
          ["CHILD", [2]],
        ]),
      },
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
      })),
      [
        {
          key: "COLL",
          parentKey: undefined,
          hasChildren: true,
          level: 0,
        },
        {
          key: "CHILD",
          parentKey: "COLL",
          hasChildren: false,
          level: 1,
        },
      ],
    );
    assert.sameMembers(
      sources.map((source) => source.title),
      ["Parent Paper", "Child Paper"],
    );
  });

  it("reads Zotero DB collection rows returned as tuples", async function () {
    installZoteroMock([], [], "Library 1", {
      collections: [
        {
          id: 101,
          key: "COLL",
          libraryID: 1,
          name: "Collection",
        },
        {
          id: 102,
          key: "CHILD",
          libraryID: 1,
          name: "Child",
          parentID: 101,
        },
      ],
      collectionItems: new Map(),
      tupleRows: true,
    });
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
        createAttachment(11, "PDF-A", true),
        createAttachment(12, "PDF-B", true),
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
});

function createRegularItem(
  id: number,
  key: string,
  title: string,
  attachments: number[],
): MockItem {
  return {
    id,
    key,
    title,
    libraryID: 1,
    attachments,
    isRegularItem: () => true,
    getField: (field) =>
      field === "title" ? title : field === "date" ? "2024" : "",
    getAttachments: () => attachments,
    getCollections: () => [],
    getCreatorsJSON: () => [{ firstName: "Ada", lastName: "Lovelace" }],
  };
}

function createAttachment(id: number, key: string, pdf: boolean): MockItem {
  return {
    id,
    key,
    title: key,
    libraryID: 1,
    attachment: true,
    pdf,
    isRegularItem: () => false,
    isAttachment: () => true,
    isPDFAttachment: () => pdf,
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
  db?: {
    collections: Array<{
      id: number;
      key: string;
      libraryID: number;
      name: string;
      parentID?: number;
    }>;
    collectionItems: Map<string, number[]>;
    tupleRows?: boolean;
  },
): void {
  const itemById = new Map(items.map((item) => [item.id, item]));
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Libraries: {
      getName: () => libraryName,
    },
    Items: {
      get: (id: number | string) =>
        typeof id === "number"
          ? itemById.get(id)
          : items.find((item) => item.key === id),
      getAll: async () => items.filter((item) => item.isRegularItem?.()),
    },
    Collections: {
      getByLibrary: () => collections,
      get: (id: number) =>
        collections.find((collection) => collection.id === id),
    },
    DB: db
      ? {
          queryAsync: async (
            sql: string,
            params: unknown[],
            options?: { onRow?: (row: unknown) => void },
          ) => {
            if (sql.includes("WITH RECURSIVE")) {
              const collectionKey = String(params[1]);
              const rows = (db.collectionItems.get(collectionKey) || []).map(
                (itemID) => ({ itemID }),
              );
              if (options?.onRow) {
                rows.forEach(options.onRow);
                return undefined;
              }
              return rows;
            }
            if (db.tupleRows) {
              const rows = db.collections.map((collection) => [
                collection.id,
                collection.key,
                collection.libraryID,
                collection.name,
                collection.parentID,
              ]);
              if (options?.onRow) {
                rows.forEach(options.onRow);
                return undefined;
              }
              return rows;
            }
            if (options?.onRow) {
              db.collections.forEach(options.onRow);
              return undefined;
            }
            return db.collections;
          },
        }
      : undefined,
  };
}
