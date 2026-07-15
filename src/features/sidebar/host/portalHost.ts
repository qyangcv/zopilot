const ZOTERO_PANE_STACK_ID = "zotero-pane-stack";

function resolveSidebarPortalHost(panel: Element): Element {
  const doc = panel.ownerDocument;
  if (!doc) throw new Error("Zopilot sidebar panel has no owner document");
  const stack = doc.getElementById(ZOTERO_PANE_STACK_ID);
  if (
    !stack ||
    stack.ownerDocument !== doc ||
    !stack.isConnected ||
    !stack.contains(panel)
  ) {
    throw new Error(
      `Zotero sidebar overlay host #${ZOTERO_PANE_STACK_ID} is unavailable`,
    );
  }
  return stack;
}

export { resolveSidebarPortalHost, ZOTERO_PANE_STACK_ID };
