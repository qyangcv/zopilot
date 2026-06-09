import { assert } from "chai";
import { ZoteroContextGateway } from "../src/zotero/contextGateway.ts";
import type { PaperScope } from "../src/zotero/types.ts";

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  parentItem?: MockItem;
  attachmentText?: string;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

type MockReader = {
  itemID: number;
  tabID?: string;
  type?: string;
};

type MockFullText = {
  INDEX_STATE_INDEXED: number;
  INDEX_STATE_PARTIAL: number;
  INDEX_STATE_UNINDEXED: number;
  INDEX_STATE_QUEUED: number;
  INDEX_STATE_UNAVAILABLE: number;
  getIndexedState: (item: MockItem) => Promise<number>;
};

type MockZotero = {
  Items: {
    get: (itemID: number) => MockItem | undefined;
  };
  Reader: {
    getByTabID?: (tabID: string) => MockReader | undefined;
    _readers?: MockReader[];
  };
  Fulltext?: MockFullText;
  FullText?: MockFullText;
};

type MockWindow = Window & {
  Zotero_Tabs?: {
    selectedID?: string;
    selectedType?: string;
  };
};

const TAB_ID = "reader-tab";
const INDEXED_STATE = 1;

describe("ZoteroContextGateway", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: MockZotero }).Zotero;
  });

  it("returns null when no active reader exists", async function () {
    installZoteroMock({ items: [], readers: [] });
    const gateway = new ZoteroContextGateway(createWindow());

    assert.isNull(await gateway.getActivePaper());
  });

  it("resolves the active PDF reader scope", async function () {
    const parent = createItem({
      id: 20,
      isRegularItem: () => true,
    });
    const attachment = createItem({
      id: 10,
      key: "PDF",
      parentItem: parent,
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      items: [attachment, parent],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const scope = await requireScope(gateway);

    assert.equal(scope.source, "reader");
    assert.equal(scope.readerItemID, attachment.id);
    assert.equal(scope.attachmentItemID, attachment.id);
    assert.equal(scope.attachmentKey, "PDF");
    assert.equal(scope.parentItemID, parent.id);
    assert.equal(scope.libraryID, 1);
    assert.equal(scope.readerType, "pdf");
    assert.isEmpty(scope.warnings);
  });

  it("reports reader scope warnings without blocking paper_read", async function () {
    const item = createItem({
      id: 10,
      isAttachment: () => false,
      isPDFAttachment: () => false,
    });
    installZoteroMock({
      items: [item],
      readers: [createReader(item.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const scope = await requireScope(gateway);

    assert.equal(scope.attachmentItemID, item.id);
    assert.include(
      scope.warnings,
      "Current reader item is not a Zotero attachment.",
    );
    assert.include(
      scope.warnings,
      "Current reader attachment is not a PDF attachment.",
    );
    assert.include(
      scope.warnings,
      "Current reader attachment has no regular parent item.",
    );
  });

  it("reads normalized full text for MCP tools", async function () {
    const attachment = createItem({
      id: 10,
      attachmentText: "The   method\nuses lexical retrieval.",
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      items: [attachment],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const text = await gateway.getAttachmentFullTextForTool(
      createScope(attachment),
    );

    assert.equal(text.status, "indexed");
    assert.equal(text.text, "The method uses lexical retrieval.");
    assert.equal(text.length, text.text.length);
    assert.equal(text.indexedState, INDEXED_STATE);
  });

  it("returns an empty text result when attachmentText is empty", async function () {
    const attachment = createItem({
      id: 10,
      attachmentText: "",
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      items: [attachment],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const text = await gateway.getAttachmentFullTextForTool(
      createScope(attachment),
    );

    assert.equal(text.status, "empty");
    assert.equal(text.length, 0);
    assert.equal(text.indexedState, INDEXED_STATE);
    assert.include(
      text.warnings,
      "Attachment text is empty. The PDF may be unindexed or scanned.",
    );
  });

  it("reports unavailable text when Zotero full-text APIs are absent", async function () {
    const attachment = createItem({
      id: 10,
      attachmentText: "Readable text exists.",
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      fullText: null,
      items: [attachment],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const text = await gateway.getAttachmentFullTextForTool(
      createScope(attachment),
    );

    assert.equal(text.status, "unavailable");
    assert.include(text.warnings, "Zotero full-text index API is unavailable.");
  });
});

async function requireScope(
  gateway: ZoteroContextGateway,
): Promise<PaperScope> {
  const scope = await gateway.getActivePaper();
  assert.isNotNull(scope);
  return scope;
}

function installZoteroMock(options: {
  items: MockItem[];
  readers: MockReader[];
  fullText?: MockFullText | null;
}): void {
  const itemByID = new Map(options.items.map((item) => [item.id, item]));
  const readerByTabID = new Map(
    options.readers
      .filter((reader) => reader.tabID)
      .map((reader) => [reader.tabID as string, reader]),
  );
  const fullText =
    options.fullText === undefined ? createFullText() : options.fullText;
  const zotero: MockZotero = {
    Items: {
      get: (itemID) => itemByID.get(itemID),
    },
    Reader: {
      _readers: options.readers,
      getByTabID: (tabID) => readerByTabID.get(tabID),
    },
  };

  if (fullText) {
    zotero.Fulltext = fullText;
  }

  (globalThis as unknown as { Zotero: MockZotero }).Zotero = zotero;
}

function createFullText(): MockFullText {
  return {
    INDEX_STATE_INDEXED: INDEXED_STATE,
    INDEX_STATE_PARTIAL: 2,
    INDEX_STATE_UNINDEXED: 3,
    INDEX_STATE_QUEUED: 4,
    INDEX_STATE_UNAVAILABLE: 5,
    getIndexedState: async () => INDEXED_STATE,
  };
}

function createItem(options: Partial<MockItem> & { id: number }): MockItem {
  return {
    key: `KEY-${options.id}`,
    libraryID: 1,
    ...options,
  };
}

function createReader(itemID: number): MockReader {
  return {
    itemID,
    tabID: TAB_ID,
    type: "pdf",
  };
}

function createScope(attachment: MockItem): PaperScope {
  return {
    source: "reader",
    readerItemID: attachment.id,
    attachmentItemID: attachment.id,
    attachmentKey: attachment.key,
    parentItemID: attachment.parentItem?.id,
    libraryID: attachment.libraryID,
    readerType: "pdf",
    warnings: [],
  };
}

function createWindow(): MockWindow {
  return {} as MockWindow;
}

function createReaderWindow(): MockWindow {
  return {
    Zotero_Tabs: {
      selectedID: TAB_ID,
      selectedType: "reader",
    },
  } as MockWindow;
}
