import { getString } from "../../utils/locale";

export { getSelectedItemTitle };

function getSelectedItemTitle(
  win: Window,
  reader?: _ZoteroTypes.ReaderInstance,
): string {
  if (reader?.itemID) {
    const item = Zotero.Items.get(reader.itemID);
    const title =
      getOptionalItemTitle(item?.parentItem) || getOptionalItemTitle(item);
    return title || getString("sidebar-untitled-item");
  }

  const selectedItems = getSelectedItems(win);
  if (!selectedItems.length) {
    return getString("sidebar-no-item-selected");
  }
  if (selectedItems.length > 1) {
    return getString("sidebar-multiple-items-selected", {
      args: { count: selectedItems.length },
    });
  }

  return getItemTitle(selectedItems[0]);
}

function getSelectedItems(win: Window): Zotero.Item[] {
  const pane = (win as Window & { ZoteroPane?: _ZoteroTypes.ZoteroPane })
    .ZoteroPane;
  return pane?.getSelectedItems?.() || [];
}

function getItemTitle(item?: Zotero.Item): string {
  return getOptionalItemTitle(item) || getString("sidebar-untitled-item");
}

function getOptionalItemTitle(item?: Zotero.Item): string | undefined {
  return item?.getDisplayTitle?.() || item?.getField?.("title") || undefined;
}
