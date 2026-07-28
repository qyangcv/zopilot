import type {
  PaperIdentity,
  PaperSourceRef,
} from "../../../domain/conversation";
import { createSourceId } from "../../../domain/sourceIdentity";
import { getZoteroGlobal } from "../environment";

type ZoteroItemLike = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  deleted?: boolean;
  parentItemID?: number | false;
  parentItemKey?: string | false;
  parentItem?: Zotero.Item;
  attachmentFilename?: string;
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
  createPaperSourceRefFromAttachmentWithZotero,
  createPaperSourceRefForAttachmentWithZotero,
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
  if (isStandalonePdfAttachment(item) && !item.deleted && item.libraryID > 0) {
    return createStandalonePaperSourceRef(item, zotero);
  }
  if (!item.isRegularItem?.()) {
    return null;
  }
  const attachment = selectPdfAttachment(item, currentSource, zotero);
  if (!attachment) {
    return null;
  }
  const source = createPaperSourceRefForAttachmentWithZotero(
    item,
    attachment,
    zotero,
  );
  return source ? { ...source, title: getItemTitle(item) } : null;
}

function createPaperSourceRefFromAttachmentWithZotero(
  rawAttachment: Zotero.Item,
  zotero: typeof Zotero,
): PaperSourceRef | null {
  const attachment = rawAttachment as ZoteroItemLike;
  if (
    attachment.deleted ||
    !attachment.isAttachment?.() ||
    !attachment.isPDFAttachment?.()
  ) {
    return null;
  }
  if (isStandalonePdfAttachment(attachment)) {
    return createStandalonePaperSourceRef(attachment, zotero);
  }
  const rawParent =
    attachment.parentItem ||
    zotero.Items.get(
      (attachment.parentItemID || attachment.parentItemKey) as number | string,
    );
  return rawParent
    ? createPaperSourceRefForAttachmentWithZotero(rawParent, attachment, zotero)
    : null;
}

function createPaperSourceRefForAttachmentWithZotero(
  rawItem: Zotero.Item,
  rawAttachment: Zotero.Item,
  zotero: typeof Zotero,
): PaperSourceRef | null {
  const item = rawItem as ZoteroItemLike;
  const attachment = rawAttachment as ZoteroItemLike;
  if (
    !item.isRegularItem?.() ||
    !attachment.isAttachment?.() ||
    !attachment.isPDFAttachment?.() ||
    attachment.libraryID !== item.libraryID
  ) {
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
    title: getAttachmentTitle(attachment) || title,
    creators: getCreators(item),
    year: getYear(item),
    collectionKeys: getCollectionKeys(item, zotero),
  };
}

function createStandalonePaperSourceRef(
  attachment: ZoteroItemLike,
  zotero: typeof Zotero,
): PaperSourceRef {
  const title = getAttachmentTitle(attachment);
  return {
    sourceId: createSourceId(attachment.libraryID, attachment.key),
    paperKey: `${attachment.libraryID}:${attachment.key}`,
    libraryID: attachment.libraryID,
    attachmentItemID: attachment.id,
    attachmentKey: attachment.key,
    title,
    collectionKeys: getCollectionKeys(attachment, zotero),
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

function getAttachmentTitle(item: ZoteroItemLike): string {
  return item.getField?.("title") || item.attachmentFilename || item.key;
}

function isStandalonePdfAttachment(item: ZoteroItemLike): boolean {
  return Boolean(
    item.isAttachment?.() &&
    item.isPDFAttachment?.() &&
    !item.parentItem &&
    !item.parentItemID &&
    !item.parentItemKey,
  );
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
