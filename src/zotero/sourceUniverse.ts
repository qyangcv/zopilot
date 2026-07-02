import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../shared/conversation";
import {
  createCollectionWorkspaceIdentity,
  createItemWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
} from "../shared/conversation";
import { createLogger } from "../utils/logger";

export { ZoteroSourceUniverse, createPaperSourceRef, paperSourceRefToIdentity };

const logger = createLogger("zotero.sourceUniverse");

type CollectionOption = {
  key: string;
  libraryID: number;
  label: string;
  path: string[];
  level: number;
  parentKey?: string;
  hasChildren: boolean;
};

type SourceUniverseSnapshot = {
  workspace: WorkspaceIdentity;
  sources: PaperSourceRef[];
  collections: CollectionOption[];
};

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

type ZoteroCollectionLike = Zotero.Collection & {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentID?: number;
  parentKey?: string;
  getChildItems?: (asIDs?: false, includeDeleted?: boolean) => Zotero.Item[];
  getChildCollections?: (
    asIDs?: false,
    includeTrashed?: boolean,
  ) => Zotero.Collection[];
};

type ZoteroCollectionsLike = {
  getByLibrary: (
    libraryID: number,
    recursive?: boolean,
    includeTrashed?: boolean,
  ) => ZoteroCollectionLike[];
  get?: (id: number) => ZoteroCollectionLike | undefined;
  loadAll?: (libraryID: number) => Promise<void>;
};

type ZoteroLibrariesLike = {
  get?: (libraryID: number) =>
    | {
        name?: string;
        getName?: () => string;
      }
    | undefined;
  getName?: (libraryID: number) => string | undefined;
};

type ZoteroDBLike = {
  queryAsync?: (
    sql: string,
    params?: unknown[] | unknown,
    options?: {
      noCache?: boolean;
      onRow?: (row: unknown) => void;
    },
  ) => Promise<unknown[] | undefined>;
};

type CollectionRecord = {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentID?: number;
};

class ZoteroSourceUniverse {
  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {}

  async getSnapshot(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }): Promise<SourceUniverseSnapshot> {
    const collections = await this.listCollections(input.workspace.libraryID);
    const sources = await this.resolveSources(
      input.workspace,
      input.currentSource,
    );
    return {
      workspace: input.workspace,
      sources,
      collections,
    };
  }

  async createLibraryWorkspace(input: {
    libraryID: number;
    label?: string;
    currentSource?: PaperIdentity;
  }): Promise<WorkspaceIdentity> {
    return {
      ...createLibraryWorkspaceIdentity({
        libraryID: input.libraryID,
        label: input.label || getLibraryLabel(input.libraryID, this.zotero),
      }),
      defaultSource: input.currentSource,
    };
  }

  async createCollectionWorkspace(input: {
    libraryID: number;
    collectionKey: string;
    currentSource?: PaperIdentity;
  }): Promise<WorkspaceIdentity | null> {
    const collection = await this.findCollection(
      input.libraryID,
      input.collectionKey,
    );
    if (!collection) {
      return null;
    }
    const rows = await this.listCollectionRecords(input.libraryID);
    const path = collectionPath(collection, rows);
    return createCollectionWorkspaceIdentity({
      libraryID: input.libraryID,
      collectionKey: input.collectionKey,
      label: collection.name || input.collectionKey,
      path,
      defaultSource: input.currentSource,
    });
  }

  async createItemWorkspace(
    source: PaperSourceRef,
  ): Promise<WorkspaceIdentity> {
    return createItemWorkspaceIdentity(paperSourceRefToIdentity(source));
  }

  async resolveSources(
    workspace: WorkspaceIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    if (workspace.workspaceType === "item") {
      const source = workspace.defaultSource
        ? await this.resolvePaper(workspace.defaultSource, currentSource)
        : null;
      return source ? [source] : [];
    }

    if (workspace.workspaceType === "collection") {
      if (!workspace.collectionKey) {
        return [];
      }
      const dbItems = await this.collectionItemsFromDB(
        workspace.libraryID,
        workspace.collectionKey,
      );
      if (dbItems) {
        return this.sourcesFromItems(dbItems, currentSource);
      }
      const collection = await this.findRawCollection(
        workspace.libraryID,
        workspace.collectionKey,
      );
      if (!collection) {
        return [];
      }
      return this.sourcesFromItems(
        collectCollectionItems(collection),
        currentSource,
      );
    }

    const items = await this.zotero.Items.getAll(
      workspace.libraryID,
      true,
      false,
    );
    return this.sourcesFromItems(items, currentSource);
  }

  private async resolvePaper(
    paper: PaperIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef | null> {
    const parent = this.zotero.Items.get(
      paper.parentItemID || paper.parentItemKey,
    );
    if (!parent) {
      return null;
    }
    return createPaperSourceRefWithZotero(parent, currentSource, this.zotero);
  }

  private async sourcesFromItems(
    items: Zotero.Item[],
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    const sources = items
      .map((item) =>
        createPaperSourceRefWithZotero(item, currentSource, this.zotero),
      )
      .filter((item): item is PaperSourceRef => Boolean(item));
    return dedupeSources(sources).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }

  private async listCollections(
    libraryID: number,
  ): Promise<CollectionOption[]> {
    const records = await this.listCollectionRecords(libraryID);
    const childCounts = countChildren(records);
    return records
      .map((collection) => {
        const path = collectionPath(collection, records);
        const parent = collection.parentID
          ? records.find((item) => item.id === collection.parentID)
          : undefined;
        return {
          key: collection.key,
          libraryID: collection.libraryID,
          label: collection.name || collection.key,
          path,
          level: Math.max(0, path.length - 1),
          parentKey: parent?.key,
          hasChildren: Boolean(childCounts.get(collection.id)),
        };
      })
      .sort((left, right) =>
        left.path.join("/").localeCompare(right.path.join("/")),
      );
  }

  private async listCollectionRecords(
    libraryID: number,
  ): Promise<CollectionRecord[]> {
    const dbRows = await this.listCollectionRecordsFromDB(libraryID);
    if (dbRows?.length) {
      return dbRows;
    }
    const rawCollections = await this.listRawCollections(libraryID);
    return rawCollections.map((collection) => ({
      id: collection.id,
      key: collection.key,
      libraryID: collection.libraryID,
      name: collection.name || collection.key,
      parentID: collection.parentID,
    }));
  }

  private async listCollectionRecordsFromDB(
    libraryID: number,
  ): Promise<CollectionRecord[] | null> {
    const db = (this.zotero as unknown as { DB?: ZoteroDBLike }).DB;
    if (!db?.queryAsync) {
      return null;
    }
    try {
      const records = await queryRows(
        db,
        `SELECT C.collectionID AS id,
                C.key AS key,
                C.libraryID AS libraryID,
                C.collectionName AS name,
                C.parentCollectionID AS parentID
           FROM collections C
          WHERE C.libraryID = ?
            AND NOT EXISTS (
              SELECT 1 FROM deletedCollections DC
               WHERE DC.collectionID = C.collectionID
            )`,
        [libraryID],
        collectionRecordFromRow,
      );
      if (records.length) {
        return records;
      }
      const allRecords = await queryRows(
        db,
        `SELECT C.collectionID AS id,
                C.key AS key,
                C.libraryID AS libraryID,
                C.collectionName AS name,
                C.parentCollectionID AS parentID
           FROM collections C
          WHERE NOT EXISTS (
              SELECT 1 FROM deletedCollections DC
               WHERE DC.collectionID = C.collectionID
            )`,
        undefined,
        collectionRecordFromRow,
      );
      const libraryIDs = new Set(allRecords.map((row) => row.libraryID));
      return libraryIDs.size === 1 ? allRecords : records;
    } catch (error) {
      logger.warn("failed to read Zotero collections from DB", { error });
      return null;
    }
  }

  private async collectionItemsFromDB(
    libraryID: number,
    collectionKey: string,
  ): Promise<Zotero.Item[] | null> {
    const db = (this.zotero as unknown as { DB?: ZoteroDBLike }).DB;
    if (!db?.queryAsync) {
      return null;
    }
    try {
      const ids = await queryRows(
        db,
        `WITH RECURSIVE subtree(collectionID) AS (
            SELECT collectionID
              FROM collections
             WHERE libraryID = ? AND key = ?
            UNION ALL
            SELECT C.collectionID
              FROM collections C
              JOIN subtree S ON C.parentCollectionID = S.collectionID
          )
          SELECT DISTINCT CI.itemID AS itemID
            FROM collectionItems CI
            JOIN subtree S ON S.collectionID = CI.collectionID`,
        [libraryID, collectionKey],
        (row) => numberValue(row, "itemID", 0),
      );
      return getItemsByIds(ids, this.zotero);
    } catch (error) {
      logger.warn("failed to read Zotero collection items from DB", {
        error,
        libraryID,
        collectionKey,
      });
      return null;
    }
  }

  private async listRawCollections(
    libraryID: number,
  ): Promise<ZoteroCollectionLike[]> {
    const collectionsAPI = this.zotero
      .Collections as unknown as ZoteroCollectionsLike;
    try {
      await collectionsAPI.loadAll?.(libraryID);
    } catch (error) {
      if (isAlreadyLoadingError(error)) {
        await delay(250);
        try {
          await collectionsAPI.loadAll?.(libraryID);
        } catch (retryError) {
          logger.warn("failed to preload Zotero collections", {
            error: retryError,
            libraryID,
          });
        }
      } else {
        logger.warn("failed to preload Zotero collections", {
          error,
          libraryID,
        });
      }
    }
    const collections = collectionsAPI.getByLibrary(libraryID, true, false);
    return collections as ZoteroCollectionLike[];
  }

  private async findCollection(
    libraryID: number,
    key: string,
  ): Promise<CollectionRecord | undefined> {
    const rows = await this.listCollectionRecords(libraryID);
    return rows.find((collection) => collection.key === key);
  }

  private async findRawCollection(
    libraryID: number,
    key: string,
  ): Promise<ZoteroCollectionLike | undefined> {
    return (await this.listRawCollections(libraryID)).find(
      (collection) => collection.key === key,
    );
  }
}

async function queryRows<T>(
  db: ZoteroDBLike,
  sql: string,
  params: unknown[] | undefined,
  mapRow: (row: unknown) => T | null | undefined,
): Promise<T[]> {
  const mapped: T[] = [];
  const pushMapped = (row: unknown) => {
    const value = mapRow(row);
    if (value !== null && value !== undefined) {
      mapped.push(value);
    }
  };
  const returned = await db.queryAsync?.(sql, params, {
    noCache: true,
    onRow: pushMapped,
  });
  if (mapped.length || returned === undefined) {
    return mapped;
  }
  for (const row of returned) {
    pushMapped(row);
  }
  return mapped;
}

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

function collectCollectionItems(
  collection: ZoteroCollectionLike,
): Zotero.Item[] {
  const itemById = new Map<number, Zotero.Item>();
  const visit = (current: ZoteroCollectionLike) => {
    for (const item of current.getChildItems?.(false, false) || []) {
      itemById.set((item as ZoteroItemLike).id, item);
    }
    for (const child of current.getChildCollections?.(false, false) || []) {
      visit(child as ZoteroCollectionLike);
    }
  };
  visit(collection);
  return Array.from(itemById.values());
}

function collectionPath(
  collection: CollectionRecord,
  allCollections: CollectionRecord[],
): string[] {
  const byId = new Map(allCollections.map((item) => [item.id, item]));
  const path: string[] = [];
  let current: CollectionRecord | undefined = collection;
  while (current) {
    path.unshift(current.name || current.key);
    current = current.parentID ? byId.get(current.parentID) : undefined;
  }
  return path;
}

async function getItemsByIds(
  ids: number[],
  zotero: typeof Zotero = getZoteroGlobal(),
): Promise<Zotero.Item[]> {
  if (!ids.length) {
    return [];
  }
  const itemsAPI = zotero.Items as unknown as {
    get: (id: number) => Zotero.Item | undefined;
    getAsync?: (ids: number[]) => Promise<Zotero.Item[]>;
  };
  if (itemsAPI.getAsync) {
    return (await itemsAPI.getAsync(ids)).filter(Boolean);
  }
  return ids
    .map((id) => itemsAPI.get(id))
    .filter((item): item is Zotero.Item => Boolean(item));
}

function countChildren(collections: CollectionRecord[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const collection of collections) {
    if (collection.parentID) {
      counts.set(
        collection.parentID,
        (counts.get(collection.parentID) || 0) + 1,
      );
    }
  }
  return counts;
}

function collectionRecordFromRow(row: unknown): CollectionRecord | null {
  const id = numberValue(row, "id", 0);
  const key = stringValue(row, "key", 1);
  const libraryID = numberValue(row, "libraryID", 2);
  const name = stringValue(row, "name", 3);
  if (typeof id !== "number" || !key || typeof libraryID !== "number") {
    return null;
  }
  return {
    id,
    key,
    libraryID,
    name: name || key,
    parentID: numberValue(row, "parentID", 4),
  };
}

function stringValue(
  row: unknown,
  key: string,
  index?: number,
): string | undefined {
  const value = rowValue(row, key, index);
  return typeof value === "string" ? value : undefined;
}

function numberValue(
  row: unknown,
  key: string,
  index?: number,
): number | undefined {
  const value = rowValue(row, key, index);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function rowValue(row: unknown, key: string, index?: number): unknown {
  const indexedRow = row as
    | { getResultByIndex?: (index: number) => unknown }
    | undefined;
  if (indexedRow?.getResultByIndex && typeof index === "number") {
    return indexedRow.getResultByIndex(index);
  }
  if (Array.isArray(row) && typeof index === "number") {
    return row[index];
  }
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  if (key in record) {
    return record[key];
  }
  const lowerKey = key.toLowerCase();
  const actualKey = Object.keys(record).find(
    (entry) => entry.toLowerCase() === lowerKey,
  );
  return actualKey ? record[actualKey] : undefined;
}

function isAlreadyLoadingError(error: unknown): boolean {
  return error instanceof Error && /already loading/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeSources(sources: PaperSourceRef[]): PaperSourceRef[] {
  const byId = new Map<string, PaperSourceRef>();
  for (const source of sources) {
    byId.set(source.sourceId, source);
  }
  return Array.from(byId.values());
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
          get?: (id: number) => ZoteroCollectionLike | undefined;
        }
      ).get?.(id);
      return collection?.key;
    })
    .filter((key): key is string => Boolean(key));
}

function createSourceId(libraryID: number, attachmentKey: string): string {
  return `${libraryID}-${attachmentKey}`;
}

function getLibraryLabel(
  libraryID: number,
  zotero: typeof Zotero = getZoteroGlobal(),
): string {
  const libraries = (zotero as unknown as { Libraries?: ZoteroLibrariesLike })
    .Libraries;
  const library = libraries?.get?.(libraryID);
  return (
    library?.name ||
    library?.getName?.() ||
    libraries?.getName?.(libraryID) ||
    "My Library"
  );
}

function getZoteroGlobal(): typeof Zotero {
  const scope = globalThis as unknown as {
    Zotero?: typeof Zotero;
    ztoolkit?: {
      getGlobal?: (name: "Zotero") => typeof Zotero | undefined;
    };
  };
  const zotero = scope.ztoolkit?.getGlobal?.("Zotero") || scope.Zotero;
  if (!zotero) {
    throw new Error("Zotero global is unavailable.");
  }
  return zotero;
}
