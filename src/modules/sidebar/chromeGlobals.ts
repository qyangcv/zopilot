export { installChromeWindowGlobals };

function installChromeWindowGlobals(mountNode: HTMLElement): void {
  const win = mountNode.ownerDocument?.defaultView;
  if (!win) {
    return;
  }

  // Zotero loads plugin code in a bootstrap sandbox. React DOM and UI
  // primitives expect browser globals from the chrome window that owns the
  // mounted node.
  const root = globalThis as Record<string, unknown>;
  const constructors = [
    "Node",
    "Element",
    "HTMLElement",
    "SVGElement",
    "Document",
    "DocumentFragment",
    "ShadowRoot",
    "Event",
    "EventTarget",
    "MouseEvent",
    "KeyboardEvent",
    "PointerEvent",
    "FocusEvent",
    "InputEvent",
    "CustomEvent",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "DOMRect",
    "NodeFilter",
  ] as const;

  root.window = win;
  root.self = win;
  root.document = win.document;
  root.navigator = win.navigator;
  root.requestAnimationFrame = win.requestAnimationFrame.bind(win);
  root.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  root.getComputedStyle = win.getComputedStyle.bind(win);

  for (const name of constructors) {
    const value = (win as unknown as Record<string, unknown>)[name];
    if (value) {
      root[name] = value;
    }
  }
}
