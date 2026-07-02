export { createSourceId };

function createSourceId(libraryID: number, attachmentKey: string): string {
  return `${libraryID}-${attachmentKey}`;
}
