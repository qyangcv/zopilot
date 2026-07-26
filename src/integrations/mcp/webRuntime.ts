type AbortControllerGlobal = typeof globalThis & {
  AbortController?: typeof AbortController;
};

function installMcpWebRuntime(): void {
  if (typeof globalThis.AbortController === "function") return;

  const AbortControllerConstructor = Zotero.getMainWindow()?.AbortController;
  if (typeof AbortControllerConstructor !== "function") {
    throw new Error("AbortController is unavailable in the Zotero runtime.");
  }

  Object.defineProperty(
    globalThis as AbortControllerGlobal,
    "AbortController",
    {
      configurable: true,
      value: AbortControllerConstructor,
      writable: true,
    },
  );
}

export { installMcpWebRuntime };
