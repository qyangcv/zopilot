import type { LocalAttachmentRef } from "../../../domain/conversation";
import { geckoIO, geckoPath } from "../../../platform/gecko";
import { createTimestampId } from "../../../runtime/ids/timestampId";

const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_CLIPBOARD_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type ClipboardImageResult =
  | { status: "created"; attachment: LocalAttachmentRef }
  | { status: "ignored"; reason: "unsupported-type" | "missing-file" }
  | { status: "rejected"; reason: "too-large" | "write-failed" };

type ClipboardAttachmentDependencies = {
  profileDir?: string;
  join?: (...parts: string[]) => string;
  makeDirectory?: (path: string) => Promise<void>;
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  createId?: () => string;
};

function findClipboardImageItem(
  items: DataTransferItemList | undefined,
): DataTransferItem | undefined {
  if (!items) return undefined;
  return Array.from(items).find(
    (item) => item.kind === "file" && isSupportedClipboardImageType(item.type),
  );
}

async function persistClipboardImage(
  blob: Blob,
  mimeType = blob.type,
  deps: ClipboardAttachmentDependencies = {},
): Promise<ClipboardImageResult> {
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!normalizedMimeType) {
    return { status: "ignored", reason: "unsupported-type" };
  }
  if (blob.size > MAX_CLIPBOARD_IMAGE_BYTES) {
    return { status: "rejected", reason: "too-large" };
  }

  const fileID = deps.createId?.() || createTimestampId("clipboard");
  const extension = getImageExtension(normalizedMimeType);
  const filename = `${fileID}.${extension}`;
  const join = deps.join || geckoPath.join;
  const directory = join(
    deps.profileDir || geckoPath.profileDir,
    "zopilot",
    "attachments",
    "clipboard",
  );
  const path = join(directory, filename);
  const makeDirectory =
    deps.makeDirectory ||
    ((directoryPath: string) =>
      geckoIO.makeDirectory(directoryPath, {
        createAncestors: true,
        ignoreExisting: true,
      }));
  const write =
    deps.write ||
    ((filePath: string, bytes: Uint8Array) =>
      geckoIO.write(filePath, bytes, { flush: true }));
  const remove =
    deps.remove ||
    ((filePath: string) =>
      geckoIO.remove(filePath, { ignoreAbsent: true }).catch(() => undefined));

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await makeDirectory(directory);
    await write(path, bytes);
  } catch {
    await remove(path);
    return { status: "rejected", reason: "write-failed" };
  }

  return {
    status: "created",
    attachment: {
      id: `local-${fileID}`,
      path,
      filename,
      kind: "image",
      mimeType: normalizedMimeType,
    },
  };
}

function isSupportedClipboardImageType(type: string): boolean {
  return Boolean(normalizeMimeType(type));
}

function normalizeMimeType(
  type: string | undefined,
): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | undefined {
  const normalized = type?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized && SUPPORTED_CLIPBOARD_IMAGE_TYPES.has(normalized)
    ? (normalized as "image/png" | "image/jpeg" | "image/webp" | "image/gif")
    : undefined;
}

function getImageExtension(
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
): "png" | "jpg" | "webp" | "gif" {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

export {
  findClipboardImageItem,
  isSupportedClipboardImageType,
  MAX_CLIPBOARD_IMAGE_BYTES,
  persistClipboardImage,
};
export type { ClipboardAttachmentDependencies, ClipboardImageResult };
