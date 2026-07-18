class ZoteroLibraryItemRepository {
  constructor(private readonly zotero: typeof Zotero) {}

  async listViewItemIDs(libraryID: number): Promise<number[]> {
    // Match Zotero's library item tree. Items.getAll(..., true) has omitted
    // child annotations in some Zotero versions despite its onlyTopLevel API.
    const search = new this.zotero.Search({ libraryID });
    search.addCondition("noChildren", "true");
    return search.search();
  }

  async listViewItems(libraryID: number): Promise<Zotero.Item[]> {
    return this.getItems(await this.listViewItemIDs(libraryID));
  }

  async getItems(itemIDs: number[]): Promise<Zotero.Item[]> {
    return itemIDs.length ? this.zotero.Items.getAsync(itemIDs) : [];
  }
}

export { ZoteroLibraryItemRepository };
