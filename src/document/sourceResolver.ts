import type { WorkspaceQueryScope } from "./types";
import type { SourceIdentity } from "./types";
import type { PaperSourceRef } from "../shared/conversation";

export { ZoteroPdfSourceResolver, createSourceId };

class ZoteroPdfSourceResolver {
  async resolveDefaultSource(
    scope: WorkspaceQueryScope,
  ): Promise<SourceIdentity | null> {
    const source = scope.defaultSource;
    if (!source) {
      return null;
    }

    const attachment = Zotero.Items.get(source.attachmentItemID);
    if (!attachment?.isAttachment?.() || !attachment.isPDFAttachment?.()) {
      return null;
    }
    if (
      attachment.key !== source.attachmentKey ||
      attachment.libraryID !== source.libraryID
    ) {
      throw new Error("Bound Zotero attachment no longer matches this thread.");
    }

    const filePath = await resolveAttachmentFilePath(attachment);
    if (!filePath) {
      return null;
    }
    const stat = await IOUtils.stat(filePath);
    const bytes = await IOUtils.read(filePath);
    const pdfHash = await sha256Hex(bytes);
    const parent = attachment.parentItem;
    const title =
      parent?.getField?.("title") ||
      attachment.getField?.("title") ||
      source.paperKey;

    return {
      sourceId: createSourceId(source.libraryID, source.attachmentKey),
      paperKey: source.paperKey,
      libraryID: source.libraryID,
      attachmentItemID: source.attachmentItemID,
      attachmentKey: source.attachmentKey,
      title,
      filePath,
      mtime: stat.lastModified || 0,
      size: stat.size || bytes.byteLength,
      pdfHash,
    };
  }

  async resolveSourceRef(
    source: PaperSourceRef,
  ): Promise<SourceIdentity | null> {
    return this.resolveZoteroPdf({
      paperKey: source.paperKey,
      libraryID: source.libraryID,
      attachmentItemID: source.attachmentItemID,
      attachmentKey: source.attachmentKey,
      title: source.title,
    });
  }

  private async resolveZoteroPdf(source: {
    paperKey: string;
    libraryID: number;
    attachmentItemID: number;
    attachmentKey: string;
    title?: string;
  }): Promise<SourceIdentity | null> {
    const attachment = Zotero.Items.get(source.attachmentItemID);
    if (!attachment?.isAttachment?.() || !attachment.isPDFAttachment?.()) {
      return null;
    }
    if (
      attachment.key !== source.attachmentKey ||
      attachment.libraryID !== source.libraryID
    ) {
      throw new Error("Bound Zotero attachment no longer matches this thread.");
    }

    const filePath = await resolveAttachmentFilePath(attachment);
    if (!filePath) {
      return null;
    }
    const stat = await IOUtils.stat(filePath);
    const bytes = await IOUtils.read(filePath);
    const pdfHash = await sha256Hex(bytes);
    const parent = attachment.parentItem;
    const title =
      source.title ||
      parent?.getField?.("title") ||
      attachment.getField?.("title") ||
      source.paperKey;

    return {
      sourceId: createSourceId(source.libraryID, source.attachmentKey),
      paperKey: source.paperKey,
      libraryID: source.libraryID,
      attachmentItemID: source.attachmentItemID,
      attachmentKey: source.attachmentKey,
      title,
      filePath,
      mtime: stat.lastModified || 0,
      size: stat.size || bytes.byteLength,
      pdfHash,
    };
  }
}

async function resolveAttachmentFilePath(attachment: unknown): Promise<string> {
  const item = attachment as {
    getFilePathAsync?: () => Promise<string | false | null | undefined>;
    getFilePath?: () => string | false | null | undefined;
    filePath?: string;
  };
  if (item.getFilePathAsync) {
    const value = await item.getFilePathAsync();
    return typeof value === "string" ? value : "";
  }
  if (item.getFilePath) {
    const value = item.getFilePath();
    return typeof value === "string" ? value : "";
  }
  return item.filePath || "";
}

function createSourceId(libraryID: number, attachmentKey: string): string {
  return `${libraryID}-${attachmentKey}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
