import { assert } from "chai";
import { ZoteroContextGateway } from "../../src/integrations/zotero/ZoteroContextGateway.ts";
import type { PaperScope } from "../../src/integrations/zotero/types.ts";

type MockItem = {
  id: number;
  key: string;
  libraryID: number;
  parentItem?: MockItem;
  attachmentText?: string;
  getField?: (field: string) => string;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

type MockReader = {
  itemID: number;
  tabID?: string;
  type?: string;
};

type MockZotero = {
  Items: {
    get: (itemID: number) => MockItem | undefined;
  };
  Reader: {
    getByTabID?: (tabID: string) => MockReader | undefined;
    _readers?: MockReader[];
  };
};

type MockWindow = Window & {
  Zotero_Tabs?: {
    selectedID?: string;
    selectedType?: string;
  };
};

const TAB_ID = "reader-tab";

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

    assert.equal(scope.attachmentItemID, attachment.id);
    assert.equal(scope.attachmentKey, "PDF");
    assert.equal(scope.parentItemID, parent.id);
    assert.equal(scope.libraryID, 1);
  });

  it("does not resolve non-PDF attachment readers as paper scope", async function () {
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

    assert.isNull(await gateway.getActivePaper());
  });

  it("resolves the active PDF reader as an item workspace", async function () {
    const parent = createItem({
      id: 20,
      key: "PARENT",
      isRegularItem: () => true,
      getField: (field) => (field === "title" ? "Paper Title" : ""),
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

    const workspace = await gateway.getActiveWorkspace();

    assert.equal(workspace?.workspaceKey, "item:1:PARENT");
    assert.equal(workspace?.workspaceType, "item");
    assert.equal(workspace?.workspaceLabel, "Paper Title");
    assert.equal(workspace?.defaultSource?.attachmentKey, "PDF");
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
}): void {
  const itemByID = new Map(options.items.map((item) => [item.id, item]));
  const readerByTabID = new Map(
    options.readers
      .filter((reader) => reader.tabID)
      .map((reader) => [reader.tabID as string, reader]),
  );
  const zotero: MockZotero = {
    Items: {
      get: (itemID) => itemByID.get(itemID),
    },
    Reader: {
      _readers: options.readers,
      getByTabID: (tabID) => readerByTabID.get(tabID),
    },
  };

  (globalThis as unknown as { Zotero: MockZotero }).Zotero = zotero;
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
