export { installChromeWindowGlobals };

function installChromeWindowGlobals(mountNode: HTMLElement): void {
  const win = mountNode.ownerDocument?.defaultView;
  if (!win) {
    return;
  }

  // Zotero loads plugin code in a bootstrap sandbox. React DOM and UI
  // primitives expect browser globals from the chrome window that owns the
  // mounted node.
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

  setGlobalValue("window", win);
  setGlobalValue("self", win);
  setGlobalValue("document", win.document);
  setGlobalValue("navigator", win.navigator);
  if (typeof win.requestAnimationFrame === "function") {
    setGlobalValue(
      "requestAnimationFrame",
      win.requestAnimationFrame.bind(win),
    );
  }
  if (typeof win.cancelAnimationFrame === "function") {
    setGlobalValue("cancelAnimationFrame", win.cancelAnimationFrame.bind(win));
  }
  if (typeof win.getComputedStyle === "function") {
    setGlobalValue("getComputedStyle", win.getComputedStyle.bind(win));
  }

  for (const name of constructors) {
    const value = (win as unknown as Record<string, unknown>)[name];
    if (value) {
      setGlobalValue(name, value);
    }
  }
}

function setGlobalValue(name: string, value: unknown): void {
  const root = globalThis as Record<string, unknown>;
  try {
    root[name] = value;
    return;
  } catch {
    // Zotero preference panes expose some browser globals as getter-only
    // properties. Skip any value that cannot be installed in this sandbox.
  }

  try {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  } catch {
    // Best-effort compatibility shim: React can often use the existing
    // chrome-window getter even when the sandbox refuses reassignment.
  }
}
