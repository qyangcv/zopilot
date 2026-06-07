import { assert } from "chai";
import { ZoteroContextGateway } from "../src/zotero/contextGateway.ts";
import type { PaperScope } from "../src/zotero/types.ts";

type MockCreator = {
  firstName?: string;
  lastName?: string;
  name?: string;
};

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  itemType: string;
  parentItem?: MockItem;
  attachmentContentType?: string;
  attachmentText?: string;
  firstCreator?: string;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
  loadAllData?: () => Promise<void>;
  getDisplayTitle?: () => string;
  getField?: (
    field: string,
    unformatted?: boolean,
    includeBaseMapped?: boolean,
  ) => string | undefined;
  getCreatorsJSON?: () => MockCreator[];
  getFilePathAsync?: () => Promise<string | undefined>;
  getFilePath?: () => string | undefined;
  fileExists?: () => Promise<boolean | undefined>;
};

type MockReader = {
  itemID: number;
  tabID?: string;
  type?: string;
  _iframeWindow?: Window;
  _window?: Window;
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

  it("returns a warning context when no active reader exists", async function () {
    installZoteroMock({ items: [], readers: [] });
    const gateway = new ZoteroContextGateway(createWindow());

    const scope = await gateway.getActivePaper();
    const context = await gateway.getPromptContext();

    assert.isNull(scope);
    assert.isNull(context.scope);
    assert.equal(context.text.status, "unavailable");
    assert.include(
      context.warnings,
      "No active Zotero PDF reader paper was detected. Open the paper in the PDF reader and launch Zotero Copilot from that reader.",
    );
    assert.include(
      context.selection.warnings,
      "No active Zotero PDF reader is available.",
    );
  });

  it("reports warnings when the reader item is not an attachment", async function () {
    const item = createItem({
      id: 10,
      itemType: "journalArticle",
      isAttachment: () => false,
      isPDFAttachment: () => false,
    });
    installZoteroMock({
      items: [item],
      readers: [createReader(item.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const scope = await requireScope(gateway);
    const attachment = await gateway.getPrimaryPdfAttachment(scope);

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
    assert.isNull(attachment);
  });

  it("resolves metadata from a PDF attachment with a parent regular item", async function () {
    const parent = createItem({
      id: 20,
      key: "PARENT",
      itemType: "journalArticle",
      fields: {
        DOI: "10.123/example",
        abstractNote: "Parent abstract.",
        date: "2026-01-02",
        title: "Parent paper title",
      },
      creators: [{ firstName: "Ada", lastName: "Lovelace" }],
      isRegularItem: () => true,
    });
    const attachment = createItem({
      id: 10,
      key: "PDF",
      itemType: "attachment",
      parentItem: parent,
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isPDFAttachment: () => true,
      path: "/tmp/paper.pdf",
    });
    installZoteroMock({
      items: [attachment, parent],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const scope = await requireScope(gateway);
    const metadata = await gateway.getPaperMetadata(scope);
    const pdf = await gateway.getPrimaryPdfAttachment(scope);

    assert.equal(scope.parentItemID, parent.id);
    assert.equal(metadata.itemID, parent.id);
    assert.equal(metadata.title, "Parent paper title");
    assert.deepEqual(metadata.creators, ["Ada Lovelace"]);
    assert.equal(metadata.year, "2026");
    assert.equal(metadata.doi, "10.123/example");
    assert.equal(metadata.abstract, "Parent abstract.");
    assert.equal(pdf?.path, "/tmp/paper.pdf");
    assert.isTrue(pdf?.readable);
    assert.isEmpty(scope.warnings);
  });

  it("falls back to attachment metadata when the PDF has no parent item", async function () {
    const attachment = createItem({
      id: 10,
      key: "PDF",
      itemType: "attachment",
      fields: {
        title: "Standalone PDF",
      },
      attachmentContentType: "application/pdf",
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      items: [attachment],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const scope = await requireScope(gateway);
    const metadata = await gateway.getPaperMetadata(scope);

    assert.isUndefined(scope.parentItemID);
    assert.include(
      scope.warnings,
      "Current reader attachment has no regular parent item.",
    );
    assert.equal(metadata.itemID, attachment.id);
    assert.equal(metadata.itemType, "attachment");
    assert.equal(metadata.title, "Standalone PDF");
  });

  it("returns an empty text result when attachmentText is empty", async function () {
    const attachment = createItem({
      id: 10,
      itemType: "attachment",
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

  it("reports unavailable text status when Zotero full-text APIs are absent", async function () {
    const attachment = createItem({
      id: 10,
      itemType: "attachment",
      isAttachment: () => true,
      isPDFAttachment: () => true,
    });
    installZoteroMock({
      fullText: null,
      items: [attachment],
      readers: [createReader(attachment.id)],
    });
    const gateway = new ZoteroContextGateway(createReaderWindow());

    const text = await gateway.getAttachmentTextStatusForPrompt(
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

function createItem(
  options: Partial<MockItem> & {
    id: number;
    fields?: Record<string, string>;
    creators?: MockCreator[];
    path?: string;
  },
): MockItem {
  const fields = options.fields || {};
  const creators = options.creators || [];
  return {
    key: `KEY-${options.id}`,
    libraryID: 1,
    itemType: "journalArticle",
    loadAllData: async () => undefined,
    getDisplayTitle: () => fields.title || "",
    getField: (field) => fields[field],
    getCreatorsJSON: () => creators,
    getFilePathAsync: async () => options.path,
    getFilePath: () => options.path,
    fileExists: async () => true,
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

function createWindow(): Window {
  return {
    getSelection: () => ({
      toString: () => "",
    }),
  } as unknown as Window;
}

function createReaderWindow(): MockWindow {
  return {
    ...createWindow(),
    Zotero_Tabs: {
      selectedID: TAB_ID,
      selectedType: "reader",
    },
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
