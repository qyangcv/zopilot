function getZoteroItem(itemID: number): Zotero.Item | undefined {
  return Zotero.Items.get(itemID) || undefined;
}

export { getZoteroItem };
