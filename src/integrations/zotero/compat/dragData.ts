const ZOTERO_ITEM_FLAVOR = "zotero/item";
const MOZ_FILE_FLAVOR = "application/x-moz-file";

type SidebarDropPayload =
  | { kind: "zotero-items"; itemIDs: number[] }
  | { kind: "local-files"; paths: string[] };

type GeckoFileLike = {
  path?: unknown;
  exists?: () => boolean;
  isDirectory?: () => boolean;
  isFile?: () => boolean;
};

type GeckoDataTransfer = DataTransfer & {
  mozItemCount?: number;
  mozGetDataAt?: (format: string, index: number) => unknown;
};

function canReadSidebarDrop(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return (
    hasType(dataTransfer.types, ZOTERO_ITEM_FLAVOR) ||
    hasType(dataTransfer.types, MOZ_FILE_FLAVOR) ||
    hasType(dataTransfer.types, "Files")
  );
}

function readSidebarDropPayload(
  dataTransfer: DataTransfer | null,
): SidebarDropPayload | undefined {
  if (!dataTransfer) return undefined;

  if (hasType(dataTransfer.types, ZOTERO_ITEM_FLAVOR)) {
    let rawItemIDs = "";
    try {
      rawItemIDs = dataTransfer.getData(ZOTERO_ITEM_FLAVOR);
    } catch {
      return undefined;
    }
    const itemIDs = parseZoteroItemIDs(rawItemIDs);
    return itemIDs.length ? { kind: "zotero-items", itemIDs } : undefined;
  }

  if (
    !hasType(dataTransfer.types, MOZ_FILE_FLAVOR) &&
    !hasType(dataTransfer.types, "Files")
  ) {
    return undefined;
  }
  const paths = readLocalFilePaths(dataTransfer as GeckoDataTransfer);
  return paths.length ? { kind: "local-files", paths } : undefined;
}

function parseZoteroItemIDs(value: string): number[] {
  const seen = new Set<number>();
  const itemIDs: number[] = [];
  for (const token of value.split(/[\s,]+/u)) {
    if (!/^\d+$/u.test(token)) continue;
    const itemID = Number(token);
    if (!Number.isSafeInteger(itemID) || itemID <= 0 || seen.has(itemID)) {
      continue;
    }
    seen.add(itemID);
    itemIDs.push(itemID);
  }
  return itemIDs;
}

function readLocalFilePaths(dataTransfer: GeckoDataTransfer): string[] {
  const candidates: unknown[] = [];
  if (
    typeof dataTransfer.mozGetDataAt === "function" &&
    typeof dataTransfer.mozItemCount === "number"
  ) {
    for (let index = 0; index < dataTransfer.mozItemCount; index += 1) {
      try {
        candidates.push(dataTransfer.mozGetDataAt(MOZ_FILE_FLAVOR, index));
      } catch {
        // Ignore an unreadable native file entry.
      }
    }
  }
  if (!candidates.length) {
    candidates.push(...Array.from(dataTransfer.files || []));
  }

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const candidate of candidates) {
    const path = getUsableFilePath(candidate);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function getUsableFilePath(candidate: unknown): string | undefined {
  const file = candidate as GeckoFileLike & {
    mozFullPath?: unknown;
  };
  try {
    if (file.exists?.() === false) return undefined;
    if (file.isDirectory?.() === true || file.isFile?.() === false) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  const path =
    typeof file.path === "string"
      ? file.path
      : typeof file.mozFullPath === "string"
        ? file.mozFullPath
        : "";
  return path || undefined;
}

function hasType(types: DOMStringList | readonly string[], value: string) {
  const list = types as DOMStringList & {
    includes?: (type: string) => boolean;
  };
  return list.includes?.(value) || list.contains?.(value) || false;
}

export {
  MOZ_FILE_FLAVOR,
  ZOTERO_ITEM_FLAVOR,
  canReadSidebarDrop,
  parseZoteroItemIDs,
  readSidebarDropPayload,
};
export type { SidebarDropPayload };
