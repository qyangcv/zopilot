import { getString } from "../../../app/localization";
import type { LocalAttachmentRef } from "../../../domain/conversation";
import {
  createZoteroFilePicker,
  type ZoteroFilePicker,
} from "../../../platform/gecko";

export { createLocalAttachmentRef, pickLocalAttachment };
export type { AttachmentUploadResult, FilePickerDependencies };

type AttachmentUploadResult =
  | { status: "cancelled" }
  | { status: "selected"; attachments: LocalAttachmentRef[] };

type FilePickerDependencies = {
  createFilePicker?: () => ZoteroFilePicker;
};

async function pickLocalAttachment({
  win,
  deps = {},
}: {
  win: Window;
  deps?: FilePickerDependencies;
}): Promise<AttachmentUploadResult> {
  const picker = (deps.createFilePicker || createZoteroFilePicker)();
  picker.init(
    win,
    getString("sidebar-attachment-picker-title"),
    picker.modeOpenMultiple,
  );
  const imagePatterns = "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.tif;*.tiff;*.bmp";
  picker.appendFilter("PDF or Images", `*.pdf;${imagePatterns}`);
  picker.appendFilter("PDF", "*.pdf");
  picker.appendFilter("Images", imagePatterns);

  if ((await picker.show()) !== picker.returnOK) {
    return { status: "cancelled" };
  }
  const attachments = picker.files.map((path) => {
    const attachment = createLocalAttachmentRef(path);
    if (!attachment) throw new Error(`Unsupported attachment type: ${path}`);
    return attachment;
  });
  return attachments.length
    ? { status: "selected", attachments }
    : { status: "cancelled" };
}

function createLocalAttachmentRef(path: string): LocalAttachmentRef | null {
  const filename = path.split(/[\\/]/).pop() || path;
  const extension = filename.split(".").pop()?.toLowerCase() || "";
  if (extension === "pdf") {
    return {
      id: createAttachmentId(path),
      path,
      filename,
      kind: "pdf",
      mimeType: "application/pdf",
    };
  }
  const imageMimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
  };
  const mimeType = imageMimeTypes[extension];
  return mimeType
    ? {
        id: createAttachmentId(path),
        path,
        filename,
        kind: "image",
        mimeType,
      }
    : null;
}

function createAttachmentId(path: string): string {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 31 + path.charCodeAt(index)) >>> 0;
  }
  return `local-${hash.toString(36)}-${Date.now().toString(36)}`;
}
