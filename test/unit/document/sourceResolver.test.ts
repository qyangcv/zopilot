import { assert } from "chai";
import { ZoteroPdfSourceResolver } from "../../../src/integrations/zotero/ZoteroPdfSourceResolver.ts";
import type { WorkspaceQueryScope } from "../../../src/document/types.ts";
import type { PaperSourceRef } from "../../../src/domain/conversation.ts";

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  parentItem?: MockItem;
  filePath?: string;
  getField?: (field: string) => string;
  getFilePath?: () => string | false | null | undefined;
  getFilePathAsync?: () => Promise<string | false | null | undefined>;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
};

type MockZotero = {
  Items: {
    get: (itemID: number | string) => MockItem | undefined;
  };
};

type MockIOUtils = {
  stat: (path: string) => Promise<{ lastModified?: number; size?: number }>;
  read: (path: string) => Promise<Uint8Array>;
};

describe("ZoteroPdfSourceResolver", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: MockZotero }).Zotero;
    delete (globalThis as unknown as { IOUtils?: MockIOUtils }).IOUtils;
  });

  it("resolves the default PDF source with attachment metadata", async function () {
    const bytes = new Uint8Array([1, 2, 3]);
    const parent = createItem({
      id: 20,
      key: "PAPER-A",
      getField: (field) => (field === "title" ? "Parent Title" : ""),
    });
    const attachment = createAttachment({
      id: 10,
      key: "PDF-A",
      parentItem: parent,
      filePath: "/tmp/paper-a.pdf",
      getField: (field) => (field === "title" ? "Attachment Title" : ""),
    });
    installZoteroMock([attachment, parent]);
    installIOMock({
      "/tmp/paper-a.pdf": {
        bytes,
        lastModified: 123,
        size: 456,
      },
    });

    const source = await new ZoteroPdfSourceResolver().resolveDefaultSource(
      createScope({
        title: "Stored Workspace Title",
      }),
    );

    assert.deepInclude(source, {
      sourceId: "1-PDF-A",
      paperKey: "1:PAPER-A",
      libraryID: 1,
      attachmentItemID: 10,
      attachmentKey: "PDF-A",
      title: "Parent Title",
      filePath: "/tmp/paper-a.pdf",
      mtime: 123,
      size: 456,
    });
    assert.equal(source?.pdfHash, await sha256Hex(bytes));
  });

  it("uses the selected source title before Zotero item title", async function () {
    const parent = createItem({
      id: 20,
      key: "PAPER-A",
      getField: (field) => (field === "title" ? "Parent Title" : ""),
    });
    const attachment = createAttachment({
      id: 10,
      key: "PDF-A",
      parentItem: parent,
      filePath: "/tmp/paper-a.pdf",
    });
    installZoteroMock([attachment, parent]);
    installIOMock({
      "/tmp/paper-a.pdf": {
        bytes: new Uint8Array([4, 5, 6]),
        lastModified: 1,
        size: 3,
      },
    });

    const source = await new ZoteroPdfSourceResolver().resolveSourceRef(
      createSourceRef({
        title: "Selected Source Title",
      }),
    );

    assert.equal(source?.title, "Selected Source Title");
  });

  it("returns null when the attachment has no readable file path", async function () {
    const attachment = createAttachment({
      id: 10,
      key: "PDF-A",
      getFilePathAsync: async () => false,
    });
    installZoteroMock([attachment]);
    installIOMock({});

    const source = await new ZoteroPdfSourceResolver().resolveDefaultSource(
      createScope(),
    );

    assert.isNull(source);
  });

  it("rejects a bound source whose Zotero attachment no longer matches", async function () {
    const attachment = createAttachment({
      id: 10,
      key: "OTHER-PDF",
      filePath: "/tmp/paper-a.pdf",
    });
    installZoteroMock([attachment]);
    installIOMock({
      "/tmp/paper-a.pdf": {
        bytes: new Uint8Array([1]),
        lastModified: 1,
        size: 1,
      },
    });

    try {
      await new ZoteroPdfSourceResolver().resolveDefaultSource(createScope());
      assert.fail("expected mismatched attachment to throw");
    } catch (error) {
      assert.match(String(error), /no longer matches this thread/);
    }
  });
});

function createScope(
  patch: Partial<WorkspaceQueryScope["defaultSource"]> = {},
): WorkspaceQueryScope {
  return {
    conversationId: "conv-a",
    workspaceKey: "item:1:PAPER-A",
    workspaceType: "item",
    workspaceLabel: "Paper A",
    libraryID: 1,
    defaultSource: {
      paperKey: "1:PAPER-A",
      libraryID: 1,
      parentItemID: 20,
      parentItemKey: "PAPER-A",
      attachmentItemID: 10,
      attachmentKey: "PDF-A",
      title: "Paper A",
      ...patch,
    },
  };
}

function createSourceRef(patch: Partial<PaperSourceRef> = {}): PaperSourceRef {
  return {
    sourceId: "1-PDF-A",
    paperKey: "1:PAPER-A",
    libraryID: 1,
    parentItemID: 20,
    parentItemKey: "PAPER-A",
    attachmentItemID: 10,
    attachmentKey: "PDF-A",
    title: "Paper A",
    ...patch,
  };
}

function createItem(patch: Partial<MockItem> & { id: number }): MockItem {
  return {
    key: `KEY-${patch.id}`,
    libraryID: 1,
    ...patch,
  };
}

function createAttachment(patch: Partial<MockItem> & { id: number }): MockItem {
  return createItem({
    isAttachment: () => true,
    isPDFAttachment: () => true,
    ...patch,
  });
}

function installZoteroMock(items: MockItem[]): void {
  const itemByID = new Map<number | string, MockItem>(
    items.flatMap((item) => [
      [item.id, item],
      [item.key, item],
    ]),
  );
  (globalThis as unknown as { Zotero: MockZotero }).Zotero = {
    Items: {
      get: (itemID) => itemByID.get(itemID),
    },
  };
}

function installIOMock(
  files: Record<
    string,
    {
      bytes: Uint8Array;
      lastModified: number;
      size?: number;
    }
  >,
): void {
  (globalThis as unknown as { IOUtils: MockIOUtils }).IOUtils = {
    async stat(path) {
      const file = files[path];
      if (!file) {
        throw new Error(`Missing file: ${path}`);
      }
      return {
        lastModified: file.lastModified,
        size: file.size,
      };
    },
    async read(path) {
      const file = files[path];
      if (!file) {
        throw new Error(`Missing file: ${path}`);
      }
      return file.bytes;
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
