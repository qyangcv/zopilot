type ContextPaneActiveState = "item" | "notes" | "zopilot";

type ContextPaneProbeSuccess = {
  available: true;
  contextPane: Element;
  inner: Element;
  deck: Element & Partial<XUL.Deck>;
  itemDeck: Element;
  notesDeck: Element;
  sidenav: Element;
  notesButton: Element;
  selectionMode: "selectedPanel" | "selectedIndex";
};

type ContextPaneUnavailableResult = {
  available: false;
  zoteroVersion?: string;
  missingSelector?: string;
  reason: string;
};

type ContextPaneProbeResult =
  | ContextPaneProbeSuccess
  | ContextPaneUnavailableResult;

function probeContextPane(doc: Document): ContextPaneProbeResult {
  const contextPane = requireSelector(doc, "#zotero-context-pane");
  if (!contextPane) {
    return unavailable("#zotero-context-pane", "missing context pane");
  }
  const inner = requireSelector(doc, "#zotero-context-pane-inner");
  if (!inner) {
    return unavailable(
      "#zotero-context-pane-inner",
      "missing context pane inner",
    );
  }
  const deck = requireSelector(doc, "#zotero-context-pane-deck") as
    | (Element & Partial<XUL.Deck>)
    | undefined;
  if (!deck) {
    return unavailable("#zotero-context-pane-deck", "missing top context deck");
  }
  const itemDeck = requireSelector(doc, "#zotero-context-pane-item-deck");
  if (!itemDeck) {
    return unavailable("#zotero-context-pane-item-deck", "missing item deck");
  }
  const notesDeck = requireSelector(doc, "#zotero-context-pane-notes-deck");
  if (!notesDeck) {
    return unavailable("#zotero-context-pane-notes-deck", "missing notes deck");
  }
  if (notesDeck.parentElement !== deck) {
    return unavailable(
      "#zotero-context-pane-notes-deck",
      "notes deck is not a direct child of top context deck",
    );
  }
  const sidenav = requireSelector(doc, "#zotero-context-pane-sidenav");
  if (!sidenav) {
    return unavailable(
      "#zotero-context-pane-sidenav",
      "missing context sidenav",
    );
  }
  const notesButton =
    sidenav.querySelector('[data-pane="context-notes"]') ||
    doc.querySelector('[data-pane="context-notes"]');
  if (!notesButton) {
    return unavailable(
      '[data-pane="context-notes"]',
      "missing notes sidenav button",
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
      "#zotero-context-pane-deck",
      "top context deck cannot assign a selected panel",
    );
  }
  return {
    available: true,
    contextPane,
    inner,
    deck,
    itemDeck,
    notesDeck,
    sidenav,
    notesButton,
    selectionMode,
  };
}

function requireSelector(doc: Document, selector: string): Element | undefined {
  return doc.querySelector(selector) || undefined;
}

function unavailable(
  missingSelector: string,
  reason: string,
): ContextPaneUnavailableResult {
  return {
    available: false,
    zoteroVersion: (globalThis as { Zotero?: { version?: string } }).Zotero
      ?.version,
    missingSelector,
    reason,
  };
}

export { probeContextPane };
export type {
  ContextPaneActiveState,
  ContextPaneProbeResult,
  ContextPaneProbeSuccess,
  ContextPaneUnavailableResult,
};
