function createSourceId(libraryID: number, attachmentKey: string): string {
  return `${libraryID}-${attachmentKey}`;
}

function parseSourceId(
  sourceId: string,
  libraryID: number,
): string | undefined {
  const prefix = `${libraryID}-`;
  if (!sourceId.startsWith(prefix)) {
    return undefined;
  }
  return sourceId.slice(prefix.length) || undefined;
}

export { createSourceId, parseSourceId };
