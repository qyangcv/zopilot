type LibraryItemPaneProbeSuccess = {
  available: true;
  itemPane: Element & {
    collapsed?: boolean;
    render?: () => unknown;
  };
  deck: Element & Partial<XUL.Deck>;
  sidenav: Element;
  selectionMode: "selectedPanel" | "selectedIndex";
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
  return {
    available: true,
    itemPane,
    deck,
    sidenav,
    selectionMode,
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
