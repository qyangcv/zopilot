import type { PaperIdentity, PaperSourceRef } from "../shared/conversation";
import { createSourceId } from "../shared/sourceIdentity";
import { getZoteroGlobal } from "./zoteroEnvironment";

type ZoteroItemLike = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  parentItem?: Zotero.Item;
  getField?: (field: string) => string;
  getCreatorsJSON?: () => Array<{
    name?: string;
    firstName?: string;
    lastName?: string;
  }>;
  getAttachments?: (includeTrashed?: boolean) => number[];
  getCollections?: () => number[];
  isRegularItem?: () => boolean;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
};

type ZoteroCollectionKeyLike = Zotero.Collection & {
  key: string;
};

export {
  createPaperSourceRef,
  createPaperSourceRefWithZotero,
  dedupeSources,
  paperSourceRefToIdentity,
};

function createPaperSourceRef(
  rawItem: Zotero.Item,
  currentSource?: PaperIdentity,
): PaperSourceRef | null {
  return createPaperSourceRefWithZotero(
    rawItem,
    currentSource,
    getZoteroGlobal(),
  );
}

function createPaperSourceRefWithZotero(
  rawItem: Zotero.Item,
  currentSource: PaperIdentity | undefined,
  zotero: typeof Zotero,
): PaperSourceRef | null {
  const item = rawItem as ZoteroItemLike;
  if (!item.isRegularItem?.()) {
    return null;
  }
  const attachment = selectPdfAttachment(item, currentSource, zotero);
  if (!attachment) {
    return null;
  }
  const title = getItemTitle(item);
  const paperKey = `${item.libraryID}:${item.key}`;
  return {
    sourceId: createSourceId(item.libraryID, attachment.key),
    paperKey,
    libraryID: item.libraryID,
    parentItemID: item.id,
    parentItemKey: item.key,
    attachmentItemID: attachment.id,
    attachmentKey: attachment.key,
    title,
    creators: getCreators(item),
    year: getYear(item),
    collectionKeys: getCollectionKeys(item, zotero),
  };
}

function paperSourceRefToIdentity(source: PaperSourceRef): PaperIdentity {
  return {
    paperKey: source.paperKey,
    libraryID: source.libraryID,
    parentItemID: source.parentItemID,
    parentItemKey: source.parentItemKey,
    attachmentItemID: source.attachmentItemID,
    attachmentKey: source.attachmentKey,
    title: source.title,
  };
}

function dedupeSources(sources: PaperSourceRef[]): PaperSourceRef[] {
  const byId = new Map<string, PaperSourceRef>();
  for (const source of sources) {
    byId.set(source.sourceId, source);
  }
  return Array.from(byId.values());
}

function selectPdfAttachment(
  item: ZoteroItemLike,
  currentSource?: PaperIdentity,
  zotero: typeof Zotero = getZoteroGlobal(),
): ZoteroItemLike | null {
  const attachmentIds = item.getAttachments?.(false) || [];
  const attachments = attachmentIds
    .map((id) => zotero.Items.get(id) as ZoteroItemLike | undefined)
    .filter((attachment): attachment is ZoteroItemLike =>
      Boolean(attachment?.isAttachment?.() && attachment.isPDFAttachment?.()),
    );
  if (!attachments.length) {
    return null;
  }
  if (currentSource?.parentItemKey === item.key) {
    return (
      attachments.find(
        (attachment) => attachment.key === currentSource.attachmentKey,
      ) || attachments[0]
    );
  }
  return attachments[0];
}

function getItemTitle(item: ZoteroItemLike): string {
  return item.getField?.("title") || item.key;
}

function getCreators(item: ZoteroItemLike): string[] {
  const creators = item.getCreatorsJSON?.() || [];
  return creators
    .map(
      (creator) =>
        creator.name ||
        [creator.firstName, creator.lastName].filter(Boolean).join(" "),
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

function getYear(item: ZoteroItemLike): string | undefined {
  const date = item.getField?.("date") || "";
  return /\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/.exec(date)?.[1];
}

function getCollectionKeys(
  item: ZoteroItemLike,
  zotero: typeof Zotero = getZoteroGlobal(),
): string[] {
  const ids = item.getCollections?.() || [];
  return ids
    .map((id) => {
      const collection = (
        zotero.Collections as unknown as {
          get?: (id: number) => ZoteroCollectionKeyLike | undefined;
        }
      ).get?.(id);
      return collection?.key;
    })
    .filter((key): key is string => Boolean(key));
}
