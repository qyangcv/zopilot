import { createLogger } from "../utils/logger";
import {
  collectionRecordFromRow,
  numberValue,
  queryRows,
  type CollectionRecord,
  type ZoteroDBLike,
} from "./sourceUniverseRows";

type SourceUniverseCollectionOption = {
  key: string;
  libraryID: number;
  label: string;
  path: string[];
  level: number;
  parentKey?: string;
  hasChildren: boolean;
};

type CollectionWorkspaceInfo = {
  label: string;
  path: string[];
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

export { ZoteroCollectionRepository };
export type { SourceUniverseCollectionOption };

const logger = createLogger("zotero.sourceUniverse");

class ZoteroCollectionRepository {
  constructor(private readonly zotero: typeof Zotero) {}

  async listOptions(
    libraryID: number,
  ): Promise<SourceUniverseCollectionOption[]> {
    const records = await this.listRecords(libraryID);
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

  async getWorkspaceInfo(
    libraryID: number,
    collectionKey: string,
  ): Promise<CollectionWorkspaceInfo | null> {
    const records = await this.listRecords(libraryID);
    const collection = records.find((item) => item.key === collectionKey);
    if (!collection) {
      return null;
    }
    return {
      label: collection.name || collection.key,
      path: collectionPath(collection, records),
    };
  }

  async listItems(
    libraryID: number,
    collectionKey: string,
  ): Promise<Zotero.Item[]> {
    const dbItems = await this.collectionItemsFromDB(libraryID, collectionKey);
    if (dbItems) {
      return dbItems;
    }
    const collection = await this.findRawCollection(libraryID, collectionKey);
    return collection ? collectCollectionItems(collection) : [];
  }

  private async listRecords(libraryID: number): Promise<CollectionRecord[]> {
    const dbRows = await this.listRecordsFromDB(libraryID);
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

  private async listRecordsFromDB(
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

  private async findRawCollection(
    libraryID: number,
    key: string,
  ): Promise<ZoteroCollectionLike | undefined> {
    return (await this.listRawCollections(libraryID)).find(
      (collection) => collection.key === key,
    );
  }
}

function collectCollectionItems(
  collection: ZoteroCollectionLike,
): Zotero.Item[] {
  const itemById = new Map<number, Zotero.Item>();
  const visit = (current: ZoteroCollectionLike) => {
    for (const item of current.getChildItems?.(false, false) || []) {
      itemById.set((item as { id: number }).id, item);
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
  zotero: typeof Zotero,
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

function isAlreadyLoadingError(error: unknown): boolean {
  return error instanceof Error && /already loading/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
