import { assert } from "chai";
import { createItemWorkspaceIdentity } from "../../src/domain/conversation.ts";
import { ZoteroItemContextCatalog } from "../../src/integrations/zotero/sources/ZoteroItemContextCatalog.ts";

describe("ZoteroItemContextCatalog", function () {
  before(function () {
    installLocaleMock();
  });

  it("lists the current PDF, all other attachments, and ordinary child notes", async function () {
    const parent = createParent();
    const currentPdf = createAttachment(12, "PDF-B", {
      title: "Supplement.pdf",
      pdf: true,
      path: "/tmp/supplement.pdf",
    });
    const unavailablePdf = createAttachment(11, "PDF-A", {
      title: "Main.pdf",
      pdf: true,
      path: false,
    });
    const image = createAttachment(13, "IMAGE", {
      title: "Figure.png",
      contentType: "image/png",
    });
    const note = createNote(21, "NOTE-A", "Reading notes");
    const deletedNote = {
      ...createNote(22, "NOTE-B", "Deleted"),
      deleted: true,
    };
    const catalog = new ZoteroItemContextCatalog(
      createZoteroMock([
        parent,
        unavailablePdf,
        currentPdf,
        image,
        note,
        deletedNote,
      ]),
    );

    const tree = await catalog.getTree({
      workspace: createWorkspace(),
      currentSource: createWorkspace().defaultSource,
    });

    assert.equal(tree?.root.title, "Paper A");
    assert.deepEqual(
      tree?.nodes.map((node) => [node.kind, node.title]),
      [
        ["pdf", "Supplement.pdf"],
        ["pdf", "Main.pdf"],
        ["unsupported-attachment", "Figure.png"],
        ["note", "Reading notes"],
      ],
    );
    const [current, unavailable, unsupported, noteNode] = tree?.nodes || [];
    assert.equal(current?.kind, "pdf");
    assert.isTrue(current?.selectable);
    assert.isTrue(current?.kind === "pdf" && current.current);
    assert.equal(unavailable?.kind, "pdf");
    assert.isFalse(unavailable?.selectable);
    assert.equal(
      unavailable?.kind === "pdf" ? unavailable.disabledReason : undefined,
      "file-unavailable",
    );
    assert.equal(unsupported?.kind, "unsupported-attachment");
    assert.isFalse(unsupported?.selectable);
    assert.equal(noteNode?.kind, "note");
    assert.isTrue(noteNode?.selectable);
  });

  it("validates selected sibling PDFs in library and collection workspaces", async function () {
    const parent = createParent();
    const catalog = new ZoteroItemContextCatalog(
      createZoteroMock([
        parent,
        createAttachment(12, "PDF-B", {
          title: "Supplement.pdf",
          pdf: true,
          path: "/tmp/supplement.pdf",
        }),
      ]),
    );
    const libraryWorkspace = {
      workspaceKey: "library:1",
      workspaceType: "library" as const,
      libraryID: 1,
      workspaceLabel: "My Library",
      workspaceTitle: "My Library",
    };
    const collectionWorkspace = {
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection" as const,
      libraryID: 1,
      workspaceLabel: "Reading",
      workspaceTitle: "Reading",
      collectionKey: "COLL",
    };

    const librarySources = await catalog.resolveSelectedPdfSources(
      libraryWorkspace,
      ["1-PDF-B"],
    );
    const collectionSources = await catalog.resolveSelectedPdfSources(
      collectionWorkspace,
      ["1-PDF-B"],
    );
    const outsideSources = await catalog.resolveSelectedPdfSources(
      { ...collectionWorkspace, collectionKey: "OTHER" },
      ["1-PDF-B"],
    );

    assert.deepEqual(
      librarySources.map((source) => source.sourceId),
      ["1-PDF-B"],
    );
    assert.deepEqual(
      collectionSources.map((source) => source.sourceId),
      ["1-PDF-B"],
    );
    assert.deepEqual(outsideSources, []);
  });
});

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  dateModified?: string;
  deleted?: boolean;
  parentItemID?: number;
  parentItemKey?: string;
  attachmentContentType?: string;
  attachmentFilename?: string;
  getAttachments?: () => number[];
  getFilePathAsync?: () => Promise<string | false>;
  getField?: (field: string) => string;
  getNoteTitle?: () => string;
  getNotes?: () => number[];
  getCreatorsJSON?: () => Array<{ firstName: string; lastName: string }>;
  getCollections?: () => number[];
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

function createParent(): MockItem {
  return {
    id: 1,
    key: "PAPER",
    libraryID: 1,
    getAttachments: () => [11, 12, 13],
    getNotes: () => [21, 22],
    getField: (field) =>
      field === "title" ? "Paper A" : field === "date" ? "2026" : "",
    getCreatorsJSON: () => [{ firstName: "Ada", lastName: "Lovelace" }],
    getCollections: () => [],
    isRegularItem: () => true,
  };
}

function createAttachment(
  id: number,
  key: string,
  input: {
    title: string;
    pdf?: boolean;
    path?: string | false;
    contentType?: string;
  },
): MockItem {
  return {
    id,
    key,
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    attachmentContentType: input.contentType || "application/pdf",
    attachmentFilename: input.title,
    getField: (field) => (field === "title" ? input.title : ""),
    getFilePathAsync: async () => input.path || false,
    isAttachment: () => true,
    isPDFAttachment: () => Boolean(input.pdf),
  };
}

function createNote(id: number, key: string, title: string): MockItem {
  return {
    id,
    key,
    libraryID: 1,
    dateModified: "2026-07-17 10:00:00",
    parentItemID: 1,
    parentItemKey: "PAPER",
    getNoteTitle: () => title,
    isNote: () => true,
  };
}

function createWorkspace() {
  return createItemWorkspaceIdentity({
    paperKey: "1:PAPER",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    attachmentItemID: 12,
    attachmentKey: "PDF-B",
    title: "Paper A",
  });
}

function createZoteroMock(items: MockItem[]): typeof Zotero {
  const byID = new Map(items.map((item) => [item.id, item]));
  return {
    Items: {
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
        return [
          {
            id: 31,
            key: "COLL",
            libraryID: 1,
            name: "Reading",
            getChildItems() {
              return items.filter((item) => item.isRegularItem?.());
            },
            getChildCollections() {
              return [];
            },
          },
        ];
      },
    },
  } as unknown as typeof Zotero;
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
