type SourceUniverseCollectionOption = {
  key: string;
  libraryID: number;
  label: string;
  path: string[];
  level: number;
  parentKey?: string;
  hasChildren: boolean;
  itemCount: number;
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
  getChildItems(asIDs?: false, includeDeleted?: boolean): Zotero.Item[];
  getChildCollections(
    asIDs?: false,
    includeTrashed?: boolean,
  ): Zotero.Collection[];
};

type ZoteroCollectionsLike = {
  getByLibrary(libraryID: number, recursive?: boolean): ZoteroCollectionLike[];
};

type CollectionRecord = {
  collection: ZoteroCollectionLike;
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentID?: number;
};

export { ZoteroCollectionRepository };
export type { SourceUniverseCollectionOption };

class ZoteroCollectionRepository {
  constructor(private readonly zotero: typeof Zotero) {}

  async listOptions(
    libraryID: number,
  ): Promise<SourceUniverseCollectionOption[]> {
    const records = this.listRecords(libraryID);
    const byParent = indexChildren(records);
    return records
      .map((record) => {
        const path = collectionPath(record, records);
        const parent = record.parentID
          ? records.find((item) => item.id === record.parentID)
          : undefined;
        return {
          key: record.key,
          libraryID: record.libraryID,
          label: record.name || record.key,
          path,
          level: Math.max(0, path.length - 1),
          parentKey: parent?.key,
          hasChildren: Boolean(byParent.get(record.id)?.length),
          itemCount: collectCollectionItems(record.collection).length,
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
    const records = this.listRecords(libraryID);
    const collection = records.find((item) => item.key === collectionKey);
    return collection
      ? {
          label: collection.name || collection.key,
          path: collectionPath(collection, records),
        }
      : null;
  }

  async listItems(
    libraryID: number,
    collectionKey: string,
  ): Promise<Zotero.Item[]> {
    const collection = this.listCollections(libraryID).find(
      (candidate) => candidate.key === collectionKey,
    );
    return collection ? collectCollectionItems(collection) : [];
  }

  private listCollections(libraryID: number): ZoteroCollectionLike[] {
    const collections = this.zotero
      .Collections as unknown as ZoteroCollectionsLike;
    return collections.getByLibrary(libraryID, true);
  }

  private listRecords(libraryID: number): CollectionRecord[] {
    const collections = this.listCollections(libraryID);
    const byKey = new Map(
      collections.map((collection) => [collection.key, collection]),
    );
    return collections.map((collection) => ({
      collection,
      id: collection.id,
      key: collection.key,
      libraryID: collection.libraryID,
      name: collection.name || collection.key,
      parentID:
        collection.parentID ??
        (collection.parentKey
          ? byKey.get(collection.parentKey)?.id
          : undefined),
    }));
  }
}

function collectCollectionItems(root: ZoteroCollectionLike): Zotero.Item[] {
  const itemById = new Map<number, Zotero.Item>();
  const visitedCollections = new Set<number>();
  const visit = (collection: ZoteroCollectionLike) => {
    if (visitedCollections.has(collection.id)) return;
    visitedCollections.add(collection.id);
    for (const item of collection.getChildItems(false, false) || []) {
      const id = (item as Zotero.Item & { id: number }).id;
      if (typeof id === "number") itemById.set(id, item);
    }
    for (const child of collection.getChildCollections(false, false) || []) {
      visit(child as ZoteroCollectionLike);
    }
  };
  visit(root);
  return [...itemById.values()];
}

function collectionPath(
  collection: CollectionRecord,
  records: CollectionRecord[],
): string[] {
  const byId = new Map(records.map((item) => [item.id, item]));
  const visited = new Set<number>();
  const path: string[] = [];
  let current: CollectionRecord | undefined = collection;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.name || current.key);
    current = current.parentID ? byId.get(current.parentID) : undefined;
  }
  return path;
}

function indexChildren(
  records: CollectionRecord[],
): Map<number, CollectionRecord[]> {
  const children = new Map<number, CollectionRecord[]>();
  for (const record of records) {
    if (!record.parentID) continue;
    const siblings = children.get(record.parentID) || [];
    siblings.push(record);
    children.set(record.parentID, siblings);
  }
  return children;
}
