type LibraryItemPaneProbeSuccess = {
  available: true;
  itemPane: Element & {
    collapsed?: boolean;
    render?: () => unknown;
  };
  deck: Element & Partial<XUL.Deck>;
  sidenav: Element;
  selectionMode: "selectedPanel" | "selectedIndex";
  widthCapability?: {
    layoutSwitcher: Element;
    sibling: Element;
    splitter: Element;
  };
};

type LibraryItemPaneUnavailableResult = {
  available: false;
  zoteroVersion?: string;
  missingSelector?: string;
  reason: string;
};

type LibraryItemPaneProbeResult =
  | LibraryItemPaneProbeSuccess
  | LibraryItemPaneUnavailableResult;

function probeLibraryItemPane(doc: Document): LibraryItemPaneProbeResult {
  const itemPane = doc.querySelector("#zotero-item-pane") as
    | LibraryItemPaneProbeSuccess["itemPane"]
    | null;
  if (!itemPane) {
    return unavailable("#zotero-item-pane", "missing library item pane");
  }
  const deck = doc.querySelector("#zotero-item-pane-content") as
    | LibraryItemPaneProbeSuccess["deck"]
    | null;
  if (!deck) {
    return unavailable(
      "#zotero-item-pane-content",
      "missing library item pane deck",
    );
  }
  const sidenav = doc.querySelector("#zotero-view-item-sidenav");
  if (!sidenav) {
    return unavailable(
      "#zotero-view-item-sidenav",
      "missing library item pane sidenav",
    );
  }
  const selectionMode =
    "selectedPanel" in deck
      ? "selectedPanel"
      : "selectedIndex" in deck
        ? "selectedIndex"
        : undefined;
  if (!selectionMode) {
    return unavailable(
      "#zotero-item-pane-content",
      "library item pane deck cannot select a panel",
    );
  }
  const layoutSwitcher = doc.querySelector("#zotero-layout-switcher");
  const sibling = doc.querySelector("#zotero-items-pane-container");
  const splitter = doc.querySelector("#zotero-items-splitter");
  const widthCapability =
    layoutSwitcher &&
    sibling &&
    splitter &&
    itemPane.parentElement === layoutSwitcher &&
    sibling.parentElement === layoutSwitcher &&
    splitter.parentElement === layoutSwitcher
      ? { layoutSwitcher, sibling, splitter }
      : undefined;
  return {
    available: true,
    itemPane,
    deck,
    sidenav,
    selectionMode,
    widthCapability,
  };
}

function unavailable(
  missingSelector: string,
  reason: string,
): LibraryItemPaneUnavailableResult {
  return {
    available: false,
    zoteroVersion: (globalThis as { Zotero?: { version?: string } }).Zotero
      ?.version,
    missingSelector,
    reason,
  };
}

export { probeLibraryItemPane };
export type {
  LibraryItemPaneProbeResult,
  LibraryItemPaneProbeSuccess,
  LibraryItemPaneUnavailableResult,
};
