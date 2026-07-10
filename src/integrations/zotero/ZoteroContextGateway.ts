import type { PaperScope } from "./types";
import { getSelectedReader } from "./reader";
import {
  createItemWorkspaceIdentity,
  type WorkspaceIdentity,
} from "../../domain/conversation";
import { createPaperIdentity } from "./paperIdentity";

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

  async getActiveWorkspace(
    reader?: _ZoteroTypes.ReaderInstance,
  ): Promise<WorkspaceIdentity | null> {
    const scope = await this.getActivePaper(reader);
    const paper = scope ? createPaperIdentity(scope) : null;
    return paper ? createItemWorkspaceIdentity(paper) : null;
  }
}
