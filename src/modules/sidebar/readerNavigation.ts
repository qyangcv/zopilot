import { getSelectedPDFReader, isPDFReader } from "../../zotero/reader";

export {
  extractReaderLocators,
  navigateReaderLocator,
  readerLocatorToLocation,
};
export type { ReaderLocator };

type ReaderLocator =
  | {
      kind: "page";
      page: number;
      label: string;
    }
  | {
      kind: "annotation";
      annotationKey: string;
      label: string;
    };

function extractReaderLocators(text: string, limit = 4): ReaderLocator[] {
  const matches: Array<{ index: number; locator: ReaderLocator }> = [];
  const seen = new Set<string>();
  const patterns = [
    /\bpages?\s+(\d{1,4})\b/gi,
    /\bp\.\s*(\d{1,4})\b/gi,
    /\bpage[:：]\s*(\d{1,4})\b/gi,
    /第\s*(\d{1,4})\s*页/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const page = Number(match[1]);
      if (!Number.isInteger(page) || page <= 0) {
        continue;
      }
      const key = `page:${page}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      matches.push({
        index: match.index ?? Number.MAX_SAFE_INTEGER,
        locator: { kind: "page", page, label: `p. ${page}` },
      });
    }
  }

  for (const match of text.matchAll(
    /\bannotation[:：]\s*([A-Z0-9_-]{4,})\b/gi,
  )) {
    const annotationKey = match[1]!;
    const key = `annotation:${annotationKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    matches.push({
      index: match.index ?? Number.MAX_SAFE_INTEGER,
      locator: {
        kind: "annotation",
        annotationKey,
        label: `annotation ${annotationKey}`,
      },
    });
  }

  return matches
    .sort((a, b) => a.index - b.index)
    .slice(0, limit)
    .map((match) => match.locator);
}

async function navigateReaderLocator(
  win: Window,
  locator: ReaderLocator,
  options: {
    itemID?: number;
    reader?: _ZoteroTypes.ReaderInstance;
  } = {},
): Promise<boolean> {
  const location = readerLocatorToLocation(locator);
  const reader =
    (isPDFReader(options.reader) ? options.reader : undefined) ||
    getSelectedPDFReader(win);
  if (reader) {
    await reader.navigate(location);
    reader.focus();
    return true;
  }
  if (!options.itemID) {
    return false;
  }
  await Zotero.Reader.open(options.itemID, location, {
    openInBackground: false,
  });
  return true;
}

function readerLocatorToLocation(
  locator: ReaderLocator,
): _ZoteroTypes.Reader.Location {
  if (locator.kind === "annotation") {
    return { annotationKey: locator.annotationKey };
  }
  return {
    pageIndex: locator.page - 1,
    pageLabel: String(locator.page),
  };
}
