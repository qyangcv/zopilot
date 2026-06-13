export { getOpenReaders, getSelectedPDFReader, getSelectedReader, isPDFReader };

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

function getSelectedReader(
  win: Window,
): _ZoteroTypes.ReaderInstance | undefined {
  const tabs = (win as ReaderWindow).Zotero_Tabs;
  const tabID = tabs?.selectedID;
  if (!tabID || tabs?.selectedType !== "reader") {
    return undefined;
  }

  const reader = Zotero.Reader.getByTabID?.(tabID);
  if (reader?.itemID) {
    return reader;
  }

  return getOpenReaders().find((candidate) => {
    return candidate.tabID === tabID && candidate.itemID;
  });
}

function getOpenReaders(): _ZoteroTypes.ReaderInstance[] {
  return (Zotero.Reader as ReaderRegistry)._readers || [];
}

function isPDFReader(
  reader?: _ZoteroTypes.ReaderInstance,
): reader is _ZoteroTypes.ReaderInstance<"pdf"> {
  return reader?.type === "pdf";
}
