type ZoteroItemReference = {
  libraryID: number;
  itemID?: number | false;
  itemKey?: string | false;
};

async function loadZoteroItem<T extends Zotero.Item>(
  zotero: typeof Zotero,
  reference: ZoteroItemReference,
): Promise<T | undefined> {
  try {
    const item = reference.itemID
      ? await zotero.Items.getAsync(reference.itemID)
      : reference.itemKey
        ? await zotero.Items.getByLibraryAndKeyAsync(
            reference.libraryID,
            reference.itemKey,
          )
        : undefined;
    return (item || undefined) as T | undefined;
  } catch {
    return undefined;
  }
}

function loadCachedZoteroItem<T extends Zotero.Item>(
  cache: Map<string, Promise<T | undefined>>,
  zotero: typeof Zotero,
  reference: ZoteroItemReference,
): Promise<T | undefined> {
  const key = reference.itemID
    ? `id:${reference.itemID}`
    : `key:${reference.libraryID}:${reference.itemKey || ""}`;
  let item = cache.get(key);
  if (!item) {
    item = loadZoteroItem<T>(zotero, reference);
    cache.set(key, item);
  }
  return item;
}

export { loadCachedZoteroItem, loadZoteroItem };
export type { ZoteroItemReference };
