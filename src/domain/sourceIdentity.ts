function createSourceId(libraryID: number, attachmentKey: string): string {
  return `${libraryID}-${attachmentKey}`;
}

export { createSourceId };
