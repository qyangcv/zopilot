import type {
  PaperMetadata,
  PaperPromptContext,
  PaperScope,
  PaperTextResult,
  PdfAttachment,
  SelectedTextResult,
} from "./types";

export { ZoteroContextGateway };

const TEXT_PREVIEW_LIMIT = 12000;
const SELECTED_TEXT_LIMIT = 8000;

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
      libraryID: attachment.libraryID,
      readerType: activeReader.type,
      warnings,
    };
  }

  async getPaperMetadata(scope: PaperScope): Promise<PaperMetadata> {
    const item = this.getMetadataItem(scope);
    const warnings = [...scope.warnings];
    if (!item) {
      warnings.push("Unable to resolve current Zotero paper item.");
      return {
        itemID: scope.parentItemID || scope.attachmentItemID,
        libraryID: scope.libraryID,
        key: scope.attachmentKey,
        itemType: "unknown",
        title: "",
        creators: [],
        warnings,
      };
    }

    await item.loadAllData?.().catch((error: unknown) => {
      warnings.push(`Unable to load complete item data: ${String(error)}`);
    });

    const date = getOptionalField(item, "date");
    return {
      itemID: item.id,
      libraryID: item.libraryID,
      key: item.key,
      itemType: item.itemType,
      title: getItemTitle(item),
      creators: getCreatorNames(item),
      date,
      year: extractYear(date),
      doi: getOptionalField(item, "DOI"),
      abstract: getOptionalField(item, "abstractNote"),
      warnings,
    };
  }

  async getPrimaryPdfAttachment(
    scope: PaperScope,
  ): Promise<PdfAttachment | null> {
    const attachment = Zotero.Items.get(scope.attachmentItemID);
    if (!attachment?.isAttachment?.()) {
      return null;
    }

    const warnings = [...scope.warnings];
    const contentType = attachment.attachmentContentType || undefined;
    const isPdf =
      Boolean(attachment.isPDFAttachment?.()) ||
      contentType === "application/pdf";

    if (!isPdf) {
      warnings.push("Current reader attachment content type is not PDF.");
    }

    const path = await this.getAttachmentPath(attachment, warnings);
    const exists = await attachment.fileExists?.().catch((error: unknown) => {
      warnings.push(
        `Unable to check attachment file existence: ${String(error)}`,
      );
      return undefined;
    });
    const readable = isPdf && Boolean(path) && exists !== false;

    if (!path) {
      warnings.push("Current PDF attachment does not have a local file path.");
    } else if (exists === false) {
      warnings.push("Current PDF attachment file does not exist locally.");
    }

    return {
      itemID: attachment.id,
      libraryID: attachment.libraryID,
      key: attachment.key,
      title: getItemTitle(attachment),
      contentType,
      path,
      isPdf,
      exists,
      readable,
      warnings,
    };
  }

  // Tool/retrieval path: reads and returns the complete Zotero full-text body.
  // Do not call this while building the regular chat prompt.
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
          preview: "",
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
        preview: truncateText(text, TEXT_PREVIEW_LIMIT),
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

  // Prompt path: reads only full-text index status, not attachment text.
  // This keeps prompts lightweight while preserving the full-text tool API above.
  async getAttachmentTextStatusForPrompt(
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
    return {
      status: getTextStatus(indexedState),
      text: "",
      preview: "",
      length: 0,
      indexedState,
      warnings,
    };
  }

  async getSelectedText(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<SelectedTextResult> {
    const activeReader = reader || this.getCurrentReader();
    if (!activeReader) {
      return {
        status: "unavailable",
        text: "",
        warnings: ["No active Zotero PDF reader is available."],
      };
    }

    try {
      const text = truncateText(
        normalizeText(
          getWindowSelectionText(activeReader._iframeWindow) ||
            getWindowSelectionText(activeReader._window) ||
            getWindowSelectionText(this.win),
        ),
        SELECTED_TEXT_LIMIT,
      );

      return {
        status: text ? "selected" : "empty",
        text,
        warnings: text ? [] : ["No reader text selection is available."],
      };
    } catch (error) {
      return {
        status: "error",
        text: "",
        warnings: [`Unable to read reader selection: ${String(error)}`],
      };
    }
  }

  async getPromptContext(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<PaperPromptContext> {
    const scope = await this.getActivePaper(reader);
    const selection = await this.getSelectedText(reader);
    if (!scope) {
      const warnings = [
        "No active Zotero PDF reader paper was detected. Open the paper in the PDF reader and launch Zotero Copilot from that reader.",
        ...selection.warnings,
      ];
      return {
        scope: null,
        metadata: null,
        attachment: null,
        text: createEmptyTextResult("unavailable", warnings),
        selection,
        warnings,
      };
    }

    const [metadata, attachment, text] = await Promise.all([
      this.getPaperMetadata(scope),
      this.getPrimaryPdfAttachment(scope),
      this.getAttachmentTextStatusForPrompt(scope),
    ]);
    const warnings = uniqueStrings([
      ...scope.warnings,
      ...metadata.warnings,
      ...(attachment?.warnings || []),
      ...text.warnings,
      ...selection.warnings,
    ]);

    return {
      scope,
      metadata,
      attachment,
      text,
      selection,
      warnings,
    };
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

  private getMetadataItem(scope: PaperScope): Zotero.Item | undefined {
    const attachment = Zotero.Items.get(scope.attachmentItemID);
    return attachment?.parentItem || attachment || undefined;
  }

  private async getAttachmentPath(
    attachment: Zotero.Item,
    warnings: string[],
  ): Promise<string | undefined> {
    try {
      const asyncPath = await attachment.getFilePathAsync?.();
      if (asyncPath) {
        return asyncPath;
      }
    } catch (error) {
      warnings.push(
        `Unable to resolve async attachment path: ${String(error)}`,
      );
    }

    const path = attachment.getFilePath?.();
    return path || undefined;
  }
}

function getItemTitle(item: Zotero.Item): string {
  return item.getDisplayTitle?.() || getOptionalField(item, "title") || "";
}

function getOptionalField(
  item: Zotero.Item,
  field: string,
): string | undefined {
  const value = item.getField?.(field, false, true)?.trim();
  return value || undefined;
}

function getCreatorNames(item: Zotero.Item): string[] {
  const creators = item.getCreatorsJSON?.() || [];
  const names = creators
    .map((creator) => {
      if (creator.name) {
        return creator.name;
      }
      return [creator.firstName, creator.lastName].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  if (names.length) {
    return names;
  }
  return item.firstCreator ? [item.firstCreator] : [];
}

function extractYear(date?: string): string | undefined {
  return date?.match(/\b(15|16|17|18|19|20)\d{2}\b/)?.[0];
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
    preview: "",
    length: 0,
    warnings,
  };
}

function getWindowSelectionText(win?: Window): string {
  return win?.getSelection?.()?.toString?.() || "";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trim()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
