import { assert } from "chai";
import { createItemWorkspaceIdentity } from "../../../src/domain/conversation.ts";
import { ZoteroDroppedContextResolver } from "../../../src/features/sidebar/context/ZoteroDroppedContextResolver.ts";

describe("ZoteroDroppedContextResolver", function () {
  before(function () {
    installLocaleMock();
  });

  it("resolves supported library items in drag order", async function () {
    const fixture = createFixture();
    const resolver = new ZoteroDroppedContextResolver(fixture.zotero);

    const result = await resolver.resolve({
      payload: {
        kind: "zotero-items",
        itemIDs: [2, 1, 12, 13, 20, 21, 22, 23, 4],
      },
      workspace: createLibraryWorkspace(),
    });

    assert.deepEqual(
      result.map((candidate) => [
        candidate.kind,
        candidate.kind === "source"
          ? candidate.source.attachmentKey
          : candidate.kind === "note"
            ? candidate.note.noteItemKey
            : candidate.attachment.filename,
      ]),
      [
        ["source", "PDF-A"],
        ["source", "PDF-B"],
        ["local-attachment", "figure.png"],
        ["local-attachment", "standalone.pdf"],
        ["note", "NOTE-CHILD"],
        ["note", "NOTE-TOP"],
      ],
    );
    const notes = result.filter((candidate) => candidate.kind === "note");
    assert.equal(notes[0]?.note.parentItemKey, "PAPER-A");
    assert.isUndefined(notes[1]?.note.parentItemKey);
  });

  it("allows only collection members and their children", async function () {
    const fixture = createFixture();
    const resolver = new ZoteroDroppedContextResolver(fixture.zotero);

    const result = await resolver.resolve({
      payload: {
        kind: "zotero-items",
        itemIDs: [31, 21, 22, 20],
      },
      workspace: createCollectionWorkspace("COLL"),
    });
    const outsideResult = await resolver.resolve({
      payload: { kind: "zotero-items", itemIDs: [31, 21, 22] },
      workspace: createCollectionWorkspace("OTHER"),
    });

    assert.deepEqual(result.map(candidateIdentity), [
      "note:NOTE-CHILD",
      "note:NOTE-TOP",
      "local:standalone.pdf",
    ]);
    assert.deepEqual(outsideResult.map(candidateIdentity), ["source:PDF-C"]);
  });

  it("rejects top-level objects outside an item workspace", async function () {
    const fixture = createFixture();
    const resolver = new ZoteroDroppedContextResolver(fixture.zotero);

    const result = await resolver.resolve({
      payload: {
        kind: "zotero-items",
        itemIDs: [1, 12, 13, 20, 21, 22],
      },
      workspace: createItemWorkspace(),
    });

    assert.deepEqual(result.map(candidateIdentity), [
      "source:PDF-A",
      "source:PDF-B",
      "local:figure.png",
      "note:NOTE-CHILD",
    ]);
  });

  it("keeps only supported local PDF and image paths", async function () {
    const resolver = new ZoteroDroppedContextResolver(createFixture().zotero);

    const result = await resolver.resolve({
      payload: {
        kind: "local-files",
        paths: ["/tmp/paper.pdf", "/tmp/figure.webp", "/tmp/data.docx"],
      },
      workspace: createLibraryWorkspace(),
    });

    assert.deepEqual(result.map(candidateIdentity), [
      "local:paper.pdf",
      "local:figure.webp",
    ]);
  });
});

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  dateModified?: string;
  deleted?: boolean;
  parentItemID?: number | false;
  parentItemKey?: string | false;
  attachmentFilename?: string;
  getAttachments?: () => number[];
  getCollections?: () => number[];
  getCreatorsJSON?: () => Array<{ firstName: string; lastName: string }>;
  getField?: (field: string) => string;
  getFilePathAsync?: () => Promise<string | false>;
  getNoteTitle?: () => string;
  isAnnotation?: () => boolean;
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

function createFixture(): { zotero: typeof Zotero; items: MockItem[] } {
  const paperA = createRegularItem(1, "PAPER-A", [11, 12, 13], "Paper A");
  const noPdf = createRegularItem(2, "NO-PDF", [], "No PDF");
  const outside = createRegularItem(3, "PAPER-C", [31], "Paper C");
  const unavailable = createRegularItem(4, "UNAVAILABLE", [41], "Unavailable");
  const items = [
    paperA,
    noPdf,
    outside,
    unavailable,
    createAttachment(11, "PDF-A", "/tmp/main.pdf", {
      parent: paperA,
      pdf: true,
    }),
    createAttachment(12, "PDF-B", "/tmp/supplement.pdf", {
      parent: paperA,
      pdf: true,
    }),
    createAttachment(13, "IMAGE-A", "/tmp/figure.png", {
      parent: paperA,
    }),
    createAttachment(20, "PDF-TOP", "/tmp/standalone.pdf", {
      pdf: true,
    }),
    createNote(21, "NOTE-CHILD", "Child note", paperA),
    createNote(22, "NOTE-TOP", "Top note"),
    createAttachment(23, "DOC-TOP", "/tmp/data.docx"),
    createAttachment(31, "PDF-C", "/tmp/outside.pdf", {
      parent: outside,
      pdf: true,
    }),
    createAttachment(41, "PDF-MISSING", false, {
      parent: unavailable,
      pdf: true,
    }),
  ];
  const byID = new Map(items.map((item) => [item.id, item]));
  const collections = [
    createCollection(91, "COLL", [paperA, items[3 + 4], items[8], items[9]]),
    createCollection(92, "OTHER", [outside]),
  ];
  const zotero = {
    Items: {
      get(value: number | string) {
        return typeof value === "number"
          ? byID.get(value)
          : items.find((item) => item.key === value);
      },
      async getAsync(value: number | number[]) {
        return Array.isArray(value)
          ? value.map((id) => byID.get(id)).filter(Boolean)
          : byID.get(value);
      },
      async getByLibraryAndKeyAsync(libraryID: number, key: string) {
        return (
          items.find(
            (item) => item.libraryID === libraryID && item.key === key,
          ) || false
        );
      },
    },
    Collections: {
      get() {
        return undefined;
      },
      getByLibrary() {
        return collections;
      },
    },
  } as unknown as typeof Zotero;
  return { zotero, items };
}

function createRegularItem(
  id: number,
  key: string,
  attachments: number[],
  title: string,
): MockItem {
  return {
    id,
    key,
    libraryID: 1,
    getAttachments: () => attachments,
    getCollections: () => [],
    getCreatorsJSON: () => [{ firstName: "Ada", lastName: "Lovelace" }],
    getField: (field) =>
      field === "title" ? title : field === "date" ? "2026" : "",
    isRegularItem: () => true,
  };
}

function createAttachment(
  id: number,
  key: string,
  path: string | false,
  options: { parent?: MockItem; pdf?: boolean } = {},
): MockItem {
  const filename =
    typeof path === "string" ? path.split("/").at(-1) || key : key;
  return {
    id,
    key,
    libraryID: 1,
    parentItemID: options.parent?.id,
    parentItemKey: options.parent?.key,
    attachmentFilename: filename,
    getField: (field) => (field === "title" ? filename : ""),
    getFilePathAsync: async () => path,
    isAttachment: () => true,
    isPDFAttachment: () => Boolean(options.pdf),
  };
}

function createNote(
  id: number,
  key: string,
  title: string,
  parent?: MockItem,
): MockItem {
  return {
    id,
    key,
    libraryID: 1,
    dateModified: "2026-07-18 10:00:00",
    parentItemID: parent?.id,
    parentItemKey: parent?.key,
    getNoteTitle: () => title,
    isNote: () => true,
  };
}

function createCollection(id: number, key: string, items: MockItem[]) {
  return {
    id,
    key,
    libraryID: 1,
    name: key,
    getChildItems: () => items,
    getChildCollections: () => [],
  };
}

function createLibraryWorkspace() {
  return {
    workspaceKey: "library:1",
    workspaceType: "library" as const,
    libraryID: 1,
    workspaceLabel: "My Library",
    workspaceTitle: "My Library",
  };
}

function createCollectionWorkspace(collectionKey: string) {
  return {
    workspaceKey: `collection:1:${collectionKey}`,
    workspaceType: "collection" as const,
    libraryID: 1,
    workspaceLabel: collectionKey,
    workspaceTitle: collectionKey,
    collectionKey,
  };
}

function createItemWorkspace() {
  return createItemWorkspaceIdentity({
    paperKey: "1:PAPER-A",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER-A",
    attachmentItemID: 11,
    attachmentKey: "PDF-A",
    title: "Paper A",
  });
}

function candidateIdentity(
  candidate: Awaited<
    ReturnType<ZoteroDroppedContextResolver["resolve"]>
  >[number],
): string {
  if (candidate.kind === "source") {
    return `source:${candidate.source.attachmentKey}`;
  }
  if (candidate.kind === "note") {
    return `note:${candidate.note.noteItemKey}`;
  }
  return `local:${candidate.attachment.filename}`;
}

function installLocaleMock(): void {
  (globalThis as typeof globalThis & { addon: unknown }).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages: Array<{ id: string }>) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}
