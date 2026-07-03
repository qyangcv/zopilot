import type { WorkspaceQueryScope } from "./types";
import type { SourceIdentity } from "./types";
import type { PaperSourceRef } from "../shared/conversation";
import { createSourceId } from "../shared/sourceIdentity";

export { ZoteroPdfSourceResolver };
export { createSourceId } from "../shared/sourceIdentity";

type PdfSourceInput = {
  paperKey: string;
  libraryID: number;
  attachmentItemID: number;
  attachmentKey: string;
  title?: string;
};

type ZoteroPdfAttachment = {
  key: string;
  libraryID: number;
  parentItem?: {
    getField?: (field: string) => string;
  };
  getField?: (field: string) => string;
  isAttachment?: () => boolean;
  isPDFAttachment?: () => boolean;
};

class ZoteroPdfSourceResolver {
  async resolveDefaultSource(
    scope: WorkspaceQueryScope,
  ): Promise<SourceIdentity | null> {
    const source = scope.defaultSource;
    if (!source) {
      return null;
    }

    return resolvePdfSourceIdentity({
      paperKey: source.paperKey,
      libraryID: source.libraryID,
      attachmentItemID: source.attachmentItemID,
      attachmentKey: source.attachmentKey,
    });
  }

  async resolveSourceRef(
    source: PaperSourceRef,
  ): Promise<SourceIdentity | null> {
    return resolvePdfSourceIdentity({
      paperKey: source.paperKey,
      libraryID: source.libraryID,
      attachmentItemID: source.attachmentItemID,
      attachmentKey: source.attachmentKey,
      title: source.title,
    });
  }
}

async function resolvePdfSourceIdentity(
  source: PdfSourceInput,
): Promise<SourceIdentity | null> {
  const attachment = resolvePdfAttachment(source);
  if (!attachment) {
    return null;
  }

  const file = await readPdfFileMetadata(attachment);
  if (!file) {
    return null;
  }

  return {
    sourceId: createSourceId(source.libraryID, source.attachmentKey),
    paperKey: source.paperKey,
    libraryID: source.libraryID,
    attachmentItemID: source.attachmentItemID,
    attachmentKey: source.attachmentKey,
    title: resolveSourceTitle(source, attachment),
    filePath: file.path,
    mtime: file.mtime,
    size: file.size,
    pdfHash: file.pdfHash,
  };
}

function resolvePdfAttachment(
  source: PdfSourceInput,
): ZoteroPdfAttachment | null {
  const attachment = Zotero.Items.get(source.attachmentItemID) as
    | ZoteroPdfAttachment
    | undefined;
  if (!attachment?.isAttachment?.() || !attachment.isPDFAttachment?.()) {
    return null;
  }
  if (
    attachment.key !== source.attachmentKey ||
    attachment.libraryID !== source.libraryID
  ) {
    throw new Error("Bound Zotero attachment no longer matches this thread.");
  }
  return attachment;
}

async function readPdfFileMetadata(attachment: ZoteroPdfAttachment): Promise<{
  path: string;
  mtime: number;
  size: number;
  pdfHash: string;
} | null> {
  const filePath = await resolveAttachmentFilePath(attachment);
  if (!filePath) {
    return null;
  }
  const stat = await IOUtils.stat(filePath);
  const bytes = await IOUtils.read(filePath);
  return {
    path: filePath,
    mtime: stat.lastModified || 0,
    size: stat.size || bytes.byteLength,
    pdfHash: await sha256Hex(bytes),
  };
}

function resolveSourceTitle(
  source: PdfSourceInput,
  attachment: ZoteroPdfAttachment,
): string {
  return (
    source.title ||
    attachment.parentItem?.getField?.("title") ||
    attachment.getField?.("title") ||
    source.paperKey
  );
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
