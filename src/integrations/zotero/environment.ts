type ZoteroLibrariesLike = {
  get?: (libraryID: number) =>
    | {
        name?: string;
        getName?: () => string;
      }
    | undefined;
  getName?: (libraryID: number) => string | undefined;
};

export { getLibraryLabel, getZoteroGlobal };

function getLibraryLabel(
  libraryID: number,
  zotero: typeof Zotero = getZoteroGlobal(),
): string {
  const libraries = (zotero as unknown as { Libraries?: ZoteroLibrariesLike })
    .Libraries;
  const library = libraries?.get?.(libraryID);
  return (
    library?.name ||
    library?.getName?.() ||
    libraries?.getName?.(libraryID) ||
    "My Library"
  );
}

function getZoteroGlobal(): typeof Zotero {
  const zotero = (globalThis as unknown as { Zotero?: typeof Zotero }).Zotero;
  if (!zotero) {
    throw new Error("Zotero global is unavailable.");
  }
  return zotero;
}
