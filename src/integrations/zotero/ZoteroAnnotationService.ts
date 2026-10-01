import type { LocalAttachmentRef } from "../../domain/conversation";
import { geckoIO, geckoPath } from "../../platform/gecko";
import { sha256Hex } from "../../runtime/crypto/sha256";

const MAX_REGION_IMAGE_BYTES = 10 * 1024 * 1024;

type RegionAnnotationTarget = {
  id: string;
  key: string;
  libraryID: number;
  attachmentItemID: number;
  attachmentKey: string;
  pageLabel?: string;
  title: string;
  pageIndex: number;
};

type AnnotationItemLike = {
  id: number;
  key: string;
  libraryID: number;
  parentID?: number | false;
  annotationType?: string;
  annotationPageLabel?: string;
  annotationPosition?: string;
  deleted?: boolean;
  isPDFAttachment?: () => boolean;
  isAnnotation?: () => boolean;
  getField?: (field: string) => string;
  getAnnotations?: (includeTrashed?: boolean) => AnnotationItemLike[];
};

type AnnotationServiceDependencies = {
  profileDir?: string;
  join?: (...parts: string[]) => string;
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<Uint8Array>;
  makeDirectory?: (path: string) => Promise<void>;
  write?: (path: string, bytes: Uint8Array) => Promise<void>;
  remove?: (path: string) => Promise<void>;
  stat?: (path: string) => Promise<{ size?: number }>;
};

type RegionAskErrorCode =
  | "unavailable"
  | "too-large"
  | "copy-failed"
  | "sidebar_unavailable"
  | "attachment-limit";

class RegionAskError extends Error {
  constructor(public readonly code: RegionAskErrorCode) {
    super(`region_ask_${code}`);
  }
}

function getImageAnnotationTarget(
  reader: _ZoteroTypes.ReaderInstance,
  currentID: string,
): RegionAnnotationTarget | undefined {
  if (reader.type !== "pdf" || !currentID) return undefined;
  const attachment = reader.itemID
    ? (Zotero.Items.get(reader.itemID) as AnnotationItemLike | undefined)
    : undefined;
  if (
    !attachment ||
    attachment.deleted ||
    !attachment.libraryID ||
    !attachment.key ||
    !attachment.isPDFAttachment?.()
  )
    return undefined;

  const annotation = findAnnotation(attachment, currentID);
  if (
    !annotation ||
    annotation.deleted ||
    !annotation.isAnnotation?.() ||
    annotation.libraryID !== attachment.libraryID ||
    annotation.parentID !== attachment.id ||
    annotation.annotationType !== "image"
  ) {
    return undefined;
  }

  let position: unknown;
  try {
    position = JSON.parse(annotation.annotationPosition || "");
  } catch {
    return undefined;
  }
  const pageIndex =
    position && typeof position === "object" && "pageIndex" in position
      ? position.pageIndex
      : undefined;
  if (
    typeof pageIndex !== "number" ||
    !Number.isInteger(pageIndex) ||
    pageIndex < 0
  )
    return undefined;

  return {
    id: `region:${annotation.libraryID}:${annotation.key}`,
    key: annotation.key,
    libraryID: annotation.libraryID,
    attachmentItemID: attachment.id,
    attachmentKey: attachment.key,
    pageLabel: annotation.annotationPageLabel,
    title: attachment.getField?.("title") || attachment.key,
    pageIndex,
  };
}

function getSelectedImageAnnotationTarget(
  reader: _ZoteroTypes.ReaderInstance,
): RegionAnnotationTarget | undefined {
  // Zotero's createViewContextMenu exposes only x/y. The Reader state is the
  // compatibility fallback that identifies the image annotation selected in the PDF view.
  const selectedIDs = (
    reader._internalReader as
      { _state?: { selectedAnnotationIDs?: unknown } } | undefined
  )?._state?.selectedAnnotationIDs;
  if (!Array.isArray(selectedIDs)) return undefined;
  return selectedIDs
    .filter((id): id is string => typeof id === "string")
    .map((id) => getImageAnnotationTarget(reader, id))
    .find((target): target is RegionAnnotationTarget => Boolean(target));
}

async function copyRegionImage(
  target: RegionAnnotationTarget,
  deps: AnnotationServiceDependencies = {},
): Promise<LocalAttachmentRef> {
  if (!/^[A-Za-z0-9_-]+$/u.test(target.key))
    throw new RegionAskError("unavailable");
  const read = deps.read || ((path: string) => geckoIO.read(path));
  const exists = deps.exists || ((path: string) => geckoIO.exists(path));
  const join = deps.join || geckoPath.join;
  const sourcePath = Zotero.Annotations.getCacheImagePath({
    libraryID: target.libraryID,
    key: target.key,
  });
  if (!(await exists(sourcePath))) {
    throw new RegionAskError("unavailable");
  }
  const stat = deps.stat || ((path: string) => geckoIO.stat(path));
  const size = (await stat(sourcePath)).size;
  if (typeof size !== "number" || size <= 0)
    throw new RegionAskError("unavailable");
  if (size > MAX_REGION_IMAGE_BYTES) throw new RegionAskError("too-large");
  const bytes = await read(sourcePath);
  if (bytes.length > MAX_REGION_IMAGE_BYTES) {
    throw new RegionAskError("too-large");
  }
  if (
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    )
  )
    throw new RegionAskError("unavailable");
  const hash = await sha256Hex(bytes);

  const directory = join(
    deps.profileDir || geckoPath.profileDir,
    "zopilot",
    "attachments",
    "regions",
  );
  const filename = `region-${target.libraryID}-${target.key}-${hash}.png`;
  const destination = join(directory, filename);
  const makeDirectory =
    deps.makeDirectory ||
    ((path: string) =>
      geckoIO.makeDirectory(path, {
        createAncestors: true,
        ignoreExisting: true,
      }));
  const write =
    deps.write ||
    ((path: string, data: Uint8Array) =>
      geckoIO.write(path, data, { flush: true }));
  const remove =
    deps.remove ||
    ((path: string) =>
      geckoIO.remove(path, { ignoreAbsent: true }).catch(() => undefined));

  if (await exists(destination))
    return createRegionAttachment(target, filename, destination, hash);
  try {
    await makeDirectory(directory);
    await write(destination, bytes);
  } catch {
    await remove(destination);
    throw new RegionAskError("copy-failed");
  }
  return createRegionAttachment(target, filename, destination, hash);
}

function createRegionAttachment(
  target: RegionAnnotationTarget,
  filename: string,
  path: string,
  hash: string,
): LocalAttachmentRef {
  return {
    id: `local-${target.id}-${hash}`,
    path,
    filename,
    kind: "image",
    mimeType: "image/png",
    region: {
      annotationKey: target.key,
      attachmentKey: target.attachmentKey,
      libraryID: target.libraryID,
      pageIndex: target.pageIndex,
      pageLabel: target.pageLabel,
      title: target.title,
    },
  };
}

function findAnnotation(
  attachment: AnnotationItemLike,
  currentID: string,
): AnnotationItemLike | undefined {
  const byKey = Zotero.Items.getByLibraryAndKey?.(
    attachment.libraryID,
    currentID,
  ) as AnnotationItemLike | false | undefined;
  if (byKey) return byKey;
  if (/^\d+$/u.test(currentID)) {
    const byID = Zotero.Items.get(Number(currentID)) as
      AnnotationItemLike | undefined;
    if (byID) return byID;
  }
  return attachment
    .getAnnotations?.(false)
    .find(
      (annotation) =>
        annotation.key === currentID || String(annotation.id) === currentID,
    );
}

export {
  copyRegionImage,
  getImageAnnotationTarget,
  getSelectedImageAnnotationTarget,
  MAX_REGION_IMAGE_BYTES,
  RegionAskError,
};
export type { AnnotationServiceDependencies, RegionAnnotationTarget };
