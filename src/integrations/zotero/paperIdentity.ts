import type { PaperIdentity } from "../../domain/conversation";
import type { PaperScope } from "./types";

function createPaperIdentity(scope: PaperScope): PaperIdentity | null {
  const parentItem = scope.parentItemID
    ? Zotero.Items.get(scope.parentItemID)
    : undefined;
  const attachment = Zotero.Items.get(scope.attachmentItemID);
  if (!attachment) {
    return null;
  }
  const parentItemKey = parentItem?.key || scope.parentItemKey;
  const rootItemKey = parentItemKey || scope.attachmentKey;
  const title =
    parentItem?.getField?.("title") ||
    attachment.getField?.("title") ||
    (attachment as Zotero.Item & { attachmentFilename?: string })
      .attachmentFilename ||
    rootItemKey;
  return {
    paperKey: `${scope.libraryID}:${rootItemKey}`,
    libraryID: scope.libraryID,
    parentItemID: scope.parentItemID,
    parentItemKey,
    attachmentItemID: scope.attachmentItemID,
    attachmentKey: scope.attachmentKey,
    title,
  };
}

export { createPaperIdentity };
