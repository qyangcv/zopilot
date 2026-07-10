type ZoteroDBLike = {
  queryAsync?: (
    sql: string,
    params?: unknown[] | unknown,
    options?: {
      noCache?: boolean;
      onRow?: (row: unknown) => void;
    },
  ) => Promise<unknown[] | undefined>;
};

type CollectionRecord = {
  id: number;
  key: string;
  libraryID: number;
  name: string;
  parentID?: number;
};

export { collectionRecordFromRow, numberValue, queryRows };
export type { CollectionRecord, ZoteroDBLike };

async function queryRows<T>(
  db: ZoteroDBLike,
  sql: string,
  params: unknown[] | undefined,
  mapRow: (row: unknown) => T | null | undefined,
): Promise<T[]> {
  const mapped: T[] = [];
  const pushMapped = (row: unknown) => {
    const value = mapRow(row);
    if (value !== null && value !== undefined) {
      mapped.push(value);
    }
  };
  const returned = await db.queryAsync?.(sql, params, {
    noCache: true,
    onRow: pushMapped,
  });
  if (mapped.length || returned === undefined) {
    return mapped;
  }
  for (const row of returned) {
    pushMapped(row);
  }
  return mapped;
}

function collectionRecordFromRow(row: unknown): CollectionRecord | null {
  const id = numberValue(row, "id", 0);
  const key = stringValue(row, "key", 1);
  const libraryID = numberValue(row, "libraryID", 2);
  const name = stringValue(row, "name", 3);
  if (typeof id !== "number" || !key || typeof libraryID !== "number") {
    return null;
  }
  return {
    id,
    key,
    libraryID,
    name: name || key,
    parentID: numberValue(row, "parentID", 4),
  };
}

function stringValue(
  row: unknown,
  key: string,
  index?: number,
): string | undefined {
  const value = rowValue(row, key, index);
  return typeof value === "string" ? value : undefined;
}

function numberValue(
  row: unknown,
  key: string,
  index?: number,
): number | undefined {
  const value = rowValue(row, key, index);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

function rowValue(row: unknown, key: string, index?: number): unknown {
  const indexedRow = row as
    | { getResultByIndex?: (index: number) => unknown }
    | undefined;
  if (indexedRow?.getResultByIndex && typeof index === "number") {
    return indexedRow.getResultByIndex(index);
  }
  if (Array.isArray(row) && typeof index === "number") {
    return row[index];
  }
  if (!row || typeof row !== "object") {
    return undefined;
  }
  const record = row as Record<string, unknown>;
  if (key in record) {
    return record[key];
  }
  const lowerKey = key.toLowerCase();
  const actualKey = Object.keys(record).find(
    (entry) => entry.toLowerCase() === lowerKey,
  );
  return actualKey ? record[actualKey] : undefined;
}
