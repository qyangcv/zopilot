export {
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  getSelectedReader,
  isPDFReader,
};

type ReaderWindow = Window & {
  Zotero_Tabs?: _ZoteroTypes.Zotero_Tabs;
};

function getSelectedPDFReader(
  win: Window,
): _ZoteroTypes.ReaderInstance<"pdf"> | undefined {
  const reader = getSelectedReader(win);
  return isPDFReader(reader) ? reader : undefined;
}

async function getSelectedPDFReaderAsync(
  win: Window,
  options: { timeoutMs?: number } = {},
): Promise<_ZoteroTypes.ReaderInstance<"pdf"> | undefined> {
  const timeoutMs = options.timeoutMs ?? 500;
  const tabs = (win as ReaderWindow).Zotero_Tabs;
  const tabID = tabs?.selectedID;
  if (!tabID || tabs.selectedType !== "reader") return undefined;
  const immediate = getReaderByTabID(tabID);
  if (immediate) return isPDFReader(immediate) ? immediate : undefined;

  return new Promise((resolve) => {
    let settled = false;
    const resources: { observerID?: string; timeout?: number } = {};
    const finish = (reader?: _ZoteroTypes.ReaderInstance<"pdf">) => {
      if (settled) return;
      settled = true;
      if (resources.timeout !== undefined) {
        win.clearTimeout(resources.timeout);
      }
      if (resources.observerID !== undefined) {
        Zotero.Notifier.unregisterObserver(resources.observerID);
      }
      resolve(reader);
    };
    resources.observerID = Zotero.Notifier.registerObserver(
      {
        notify(event, type) {
          if (
            type !== "tab" ||
            (event !== "select" &&
              (event as string) !== "load" &&
              (event as string) !== "close")
          ) {
            return;
          }
          const currentTabs = (win as ReaderWindow).Zotero_Tabs;
          if (
            currentTabs?.selectedType !== "reader" ||
            currentTabs.selectedID !== tabID ||
            (event as string) === "close"
          ) {
            finish();
            return;
          }
          const reader = getReaderByTabID(tabID);
          if (reader) finish(isPDFReader(reader) ? reader : undefined);
        },
      },
      ["tab"],
      "zopilot-reader-ready",
      100,
    );
    resources.timeout = win.setTimeout(() => finish(), timeoutMs);
  });
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

function isPDFReader(
  reader?: _ZoteroTypes.ReaderInstance,
): reader is _ZoteroTypes.ReaderInstance<"pdf"> {
  return reader?.type === "pdf";
}

function getReaderByTabID(
  tabID: string,
): _ZoteroTypes.ReaderInstance | undefined {
  const reader = Zotero.Reader.getByTabID?.(tabID);
  return reader?.itemID ? reader : undefined;
}
