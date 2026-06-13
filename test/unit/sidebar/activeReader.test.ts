import { assert } from "chai";
import {
  getSelectedPDFReader,
  getSelectedReader,
  isPDFReader,
} from "../../../src/modules/sidebar/activeReader.ts";

type MockReader = {
  itemID?: number;
  tabID: string;
  type: "pdf" | "epub" | "snapshot";
};

type MockWindow = Window & {
  Zotero_Tabs?: {
    selectedID?: string;
    selectedType?: string;
  };
};

const PDF_READER = createReader("pdf-tab", "pdf");
const EPUB_READER = createReader("epub-tab", "epub");

describe("sidebar active reader helpers", function () {
  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("does not resolve a reader from the library tab", function () {
    installZoteroMock([PDF_READER]);

    const win = createWindow("zotero-pane", "pdf-tab");

    assert.isUndefined(getSelectedReader(win));
    assert.isUndefined(getSelectedPDFReader(win));
  });

  it("does not resolve non-PDF readers as PDF reader contexts", function () {
    installZoteroMock([EPUB_READER]);

    const win = createWindow("reader", "epub-tab");

    assert.strictEqual(getSelectedReader(win), EPUB_READER);
    assert.isFalse(isPDFReader(EPUB_READER as _ZoteroTypes.ReaderInstance));
    assert.isUndefined(getSelectedPDFReader(win));
  });

  it("resolves the selected PDF reader", function () {
    installZoteroMock([PDF_READER]);

    const win = createWindow("reader", "pdf-tab");

    assert.strictEqual(getSelectedReader(win), PDF_READER);
    assert.strictEqual(getSelectedPDFReader(win), PDF_READER);
    assert.isTrue(isPDFReader(PDF_READER as _ZoteroTypes.ReaderInstance));
  });

  it("falls back to the reader list when getByTabID is unavailable", function () {
    installZoteroMock([PDF_READER], { getByTabID: false });

    const win = createWindow("reader", "pdf-tab");

    assert.strictEqual(getSelectedPDFReader(win), PDF_READER);
  });
});

function installZoteroMock(
  readers: MockReader[],
  options: { getByTabID?: boolean } = {},
): void {
  const readerByTabID = new Map(
    readers.map((reader) => [reader.tabID, reader]),
  );
  const readerAPI: {
    _readers: MockReader[];
    getByTabID?: (tabID: string) => MockReader | undefined;
  } = {
    _readers: readers,
  };
  if (options.getByTabID !== false) {
    readerAPI.getByTabID = (tabID) => readerByTabID.get(tabID);
  }

  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Reader: readerAPI,
  };
}

function createReader(tabID: string, type: MockReader["type"]): MockReader {
  return {
    itemID: 10,
    tabID,
    type,
  };
}

function createWindow(selectedType: string, selectedID: string): MockWindow {
  return {
    Zotero_Tabs: {
      selectedID,
      selectedType,
    },
  } as MockWindow;
}
