import { delay } from "../../runtime/async/delay";

export {
  getOpenReaders,
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  getSelectedReader,
  isPDFReader,
};

type ReaderWindow = Window & {
  Zotero_Tabs?: _ZoteroTypes.Zotero_Tabs;
};

type ReaderRegistry = typeof Zotero.Reader & {
  _readers?: _ZoteroTypes.ReaderInstance[];
};

function getSelectedPDFReader(
  win: Window,
): _ZoteroTypes.ReaderInstance<"pdf"> | undefined {
  const reader = getSelectedReader(win);
  return isPDFReader(reader) ? reader : undefined;
}

async function getSelectedPDFReaderAsync(
  win: Window,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<_ZoteroTypes.ReaderInstance<"pdf"> | undefined> {
  const timeoutMs = options.timeoutMs ?? 500;
  const intervalMs = options.intervalMs ?? 50;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const tabs = (win as ReaderWindow).Zotero_Tabs;
    const tabID = tabs?.selectedID;
    if (!tabID || tabs?.selectedType !== "reader") {
      return undefined;
    }

    const reader = getReaderByTabID(tabID);
    if (isPDFReader(reader)) {
      await reader._initPromise?.catch(() => undefined);
      const currentTabs = (win as ReaderWindow).Zotero_Tabs;
      if (
        currentTabs?.selectedType === "reader" &&
        currentTabs.selectedID === tabID
      ) {
        return reader;
      }
    } else if (reader) {
      return undefined;
    }

    await delay(intervalMs);
  }

  return getSelectedPDFReader(win);
}

function getSelectedReader(
  win: Window,
): _ZoteroTypes.ReaderInstance | undefined {
  const tabs = (win as ReaderWindow).Zotero_Tabs;
  const tabID = tabs?.selectedID;
  if (!tabID || tabs?.selectedType !== "reader") {
    return undefined;
  }

  return getReaderByTabID(tabID);
}

function getOpenReaders(): _ZoteroTypes.ReaderInstance[] {
  return (Zotero.Reader as ReaderRegistry)._readers || [];
}

function isPDFReader(
  reader?: _ZoteroTypes.ReaderInstance,
): reader is _ZoteroTypes.ReaderInstance<"pdf"> {
  return reader?.type === "pdf";
}

function getReaderByTabID(
  tabID: string,
): _ZoteroTypes.ReaderInstance | undefined {
  const reader = Zotero.Reader.getByTabID?.(tabID);
  if (reader?.itemID) {
    return reader;
  }

  return getOpenReaders().find((candidate) => {
    return candidate.tabID === tabID && candidate.itemID;
  });
}
