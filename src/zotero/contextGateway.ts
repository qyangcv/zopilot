import type { PaperScope } from "./types";
import { getSelectedReader } from "./reader";

export { ZoteroContextGateway };

class ZoteroContextGateway {
  constructor(private readonly win: Window) {}

  async getActivePaper(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<PaperScope | null> {
    const activeReader = reader || getSelectedReader(this.win);
    if (!activeReader?.itemID) {
      return null;
    }

    const attachment = Zotero.Items.get(activeReader.itemID);
    if (!attachment) {
      return null;
    }

    if (!attachment.isAttachment?.() || !attachment.isPDFAttachment?.()) {
      return null;
    }

    const parent = attachment.parentItem;
    return {
      attachmentItemID: attachment.id,
      attachmentKey: attachment.key,
      parentItemID: parent?.id,
      parentItemKey: parent?.key,
      libraryID: attachment.libraryID,
    };
  }

  async getAttachmentFullTextForTool(scope: PaperScope): Promise<string> {
    const attachment = Zotero.Items.get(scope.attachmentItemID);
    if (!attachment?.isAttachment?.()) {
      return "";
    }

    try {
      return normalizeText((await attachment.attachmentText) || "");
    } catch {
      return "";
    }
  }
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
