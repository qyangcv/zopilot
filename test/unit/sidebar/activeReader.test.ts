import { assert } from "chai";
import {
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  getSelectedReader,
  isPDFReader,
} from "../../../src/integrations/zotero/reader.ts";

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

describe("Zotero reader helpers", function () {
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

  it("does not use the private reader list when getByTabID is unavailable", function () {
    installZoteroMock([PDF_READER], { getByTabID: false });

    const win = createWindow("reader", "pdf-tab");

    assert.isUndefined(getSelectedPDFReader(win));
  });

  it("waits briefly for the selected PDF reader to appear", async function () {
    const readers: MockReader[] = [];
    const runtime = installZoteroMock(readers);
    const win = createWindow("reader", "pdf-tab");

    setTimeout(() => {
      readers.push(PDF_READER);
      runtime.notify("load");
    }, 10);

    assert.strictEqual(
      await getSelectedPDFReaderAsync(win, { timeoutMs: 100 }),
      PDF_READER,
    );
  });

  it("does not return a reader when the selected tab changes while waiting", async function () {
    const readers: MockReader[] = [];
    const runtime = installZoteroMock(readers);
    const win = createWindow("reader", "pdf-tab");
    const promise = getSelectedPDFReaderAsync(win, {
      timeoutMs: 30,
    });

    win.Zotero_Tabs!.selectedID = "other-tab";
    readers.push(PDF_READER);
    runtime.notify("select");

    assert.isUndefined(await promise);
  });

  it("does not wait for non-PDF selected readers", async function () {
    installZoteroMock([EPUB_READER]);
    const win = createWindow("reader", "epub-tab");

    assert.isUndefined(
      await getSelectedPDFReaderAsync(win, { timeoutMs: 100 }),
    );
  });
});

function installZoteroMock(
  readers: MockReader[],
  options: { getByTabID?: boolean } = {},
): { notify(event: string): void } {
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
    readerAPI.getByTabID = (tabID) =>
      readerByTabID.get(tabID) ||
      readers.find((reader) => reader.tabID === tabID);
  }

  let observer: { notify: _ZoteroTypes.Notifier.Notify } | undefined;

  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Reader: readerAPI,
    Notifier: {
      registerObserver(next: { notify: _ZoteroTypes.Notifier.Notify }) {
        observer = next;
        return "reader-observer";
      },
      unregisterObserver() {
        observer = undefined;
      },
    },
  };
  return {
    notify(event) {
      observer?.notify(event as never, "tab", ["pdf-tab"], {});
    },
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
    setTimeout,
    clearTimeout,
  } as MockWindow;
}
