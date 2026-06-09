import type { PaperScope, PaperTextResult } from "./types";

export { ZoteroContextGateway };

class ZoteroContextGateway {
  constructor(private readonly win: Window) {}

  async getActivePaper(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<PaperScope | null> {
    const activeReader = reader || this.getCurrentReader();
    if (!activeReader?.itemID) {
      return null;
    }

    const attachment = Zotero.Items.get(activeReader.itemID);
    if (!attachment) {
      return null;
    }

    const warnings: string[] = [];
    if (!attachment.isAttachment?.()) {
      warnings.push("Current reader item is not a Zotero attachment.");
    }
    if (!attachment.isPDFAttachment?.()) {
      warnings.push("Current reader attachment is not a PDF attachment.");
    }

    const parent = attachment.parentItem;
    if (!parent?.isRegularItem?.()) {
      warnings.push("Current reader attachment has no regular parent item.");
    }

    return {
      source: "reader",
      readerItemID: activeReader.itemID,
      attachmentItemID: attachment.id,
      attachmentKey: attachment.key,
      parentItemID: parent?.id,
      parentItemKey: parent?.key,
      libraryID: attachment.libraryID,
      readerType: activeReader.type,
      warnings,
    };
  }

  async getAttachmentFullTextForTool(
    scope: PaperScope,
  ): Promise<PaperTextResult> {
    const attachment = Zotero.Items.get(scope.attachmentItemID);
    if (!attachment?.isAttachment?.()) {
      return createEmptyTextResult("unavailable", [
        "Unable to resolve current PDF attachment.",
      ]);
    }

    const warnings: string[] = [];
    const indexedState = await getFullTextIndexedState(attachment, warnings);

    try {
      const text = normalizeText((await attachment.attachmentText) || "");
      if (!text) {
        return {
          status: "empty",
          text: "",
          length: 0,
          indexedState,
          warnings: [
            ...warnings,
            "Attachment text is empty. The PDF may be unindexed or scanned.",
          ],
        };
      }

      return {
        status: getTextStatus(indexedState),
        text,
        length: text.length,
        indexedState,
        warnings,
      };
    } catch (error) {
      return createEmptyTextResult("error", [
        ...warnings,
        `Unable to read attachment text: ${String(error)}`,
      ]);
    }
  }

  private getCurrentReader(): _ZoteroTypes.ReaderInstance | undefined {
    const tabs = (
      this.win as unknown as { Zotero_Tabs?: _ZoteroTypes.Zotero_Tabs }
    ).Zotero_Tabs;
    const tabID = tabs?.selectedID;
    if (tabID && tabs?.selectedType === "reader") {
      const reader = Zotero.Reader.getByTabID?.(tabID);
      if (reader?.itemID) {
        return reader;
      }
    }

    const readers = (
      Zotero.Reader as unknown as { _readers?: _ZoteroTypes.ReaderInstance[] }
    )._readers;
    return readers?.find((reader) => reader.tabID === tabID && reader.itemID);
  }
}

async function getFullTextIndexedState(
  item: Zotero.Item,
  warnings: string[],
): Promise<number | undefined> {
  const fullText = Zotero.Fulltext || Zotero.FullText;
  if (!fullText?.getIndexedState) {
    warnings.push("Zotero full-text index API is unavailable.");
    return undefined;
  }
  return fullText.getIndexedState(item).catch((error: unknown) => {
    warnings.push(`Unable to read full-text index state: ${String(error)}`);
    return undefined;
  });
}

function getTextStatus(indexedState?: number): PaperTextResult["status"] {
  if (indexedState === undefined) {
    return "unavailable";
  }

  const fullText = Zotero.Fulltext || Zotero.FullText;
  if (!fullText) {
    return "unavailable";
  }

  switch (indexedState) {
    case fullText.INDEX_STATE_INDEXED:
      return "indexed";
    case fullText.INDEX_STATE_PARTIAL:
      return "partial";
    case fullText.INDEX_STATE_UNINDEXED:
      return "unindexed";
    case fullText.INDEX_STATE_QUEUED:
      return "queued";
    case fullText.INDEX_STATE_UNAVAILABLE:
      return "unavailable";
    default:
      return "unavailable";
  }
}

function createEmptyTextResult(
  status: PaperTextResult["status"],
  warnings: string[],
): PaperTextResult {
  return {
    status,
    text: "",
    length: 0,
    warnings,
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
