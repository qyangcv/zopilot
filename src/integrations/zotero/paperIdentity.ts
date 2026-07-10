import type { PaperIdentity } from "../../domain/conversation";
import type { PaperScope } from "./types";

function createPaperIdentity(scope: PaperScope): PaperIdentity | null {
  const parentItem = scope.parentItemID
    ? Zotero.Items.get(scope.parentItemID)
    : undefined;
  const parentItemKey = parentItem?.key || scope.parentItemKey;
  if (!parentItemKey) {
    return null;
  }
  const title =
    parentItem?.getField?.("title") ||
    Zotero.Items.get(scope.attachmentItemID)?.getField?.("title") ||
    parentItemKey;
  return {
    paperKey: `${scope.libraryID}:${parentItemKey}`,
    libraryID: scope.libraryID,
    parentItemID: scope.parentItemID,
    parentItemKey,
    attachmentItemID: scope.attachmentItemID,
    attachmentKey: scope.attachmentKey,
    title,
  };
}

export { createPaperIdentity };
