import { getString } from "../../../app/localization";
import type { LocalAttachmentRef } from "../../../domain/conversation";

export { pickLocalAttachment };
export type { AttachmentUploadResult, FilePickerDependencies };

type AttachmentUploadResult =
  | { status: "cancelled" }
  | { status: "selected"; attachments: LocalAttachmentRef[] };

type FilePickerDependencies = {
  createFilePicker?: () => nsIFilePicker;
};

async function pickLocalAttachment({
  win,
  deps = {},
}: {
  win: Window;
  deps?: FilePickerDependencies;
}): Promise<AttachmentUploadResult> {
  const picker = (deps.createFilePicker || createFilePicker)();
  const browsingContext = (
    win as Window & { browsingContext?: BrowsingContext }
  ).browsingContext;
  if (!browsingContext) {
    throw new Error(
      "Cannot open Zotero file picker without a browsing context.",
    );
  }

  picker.init(
    browsingContext,
    getString("sidebar-attachment-picker-title"),
    picker.modeOpenMultiple ?? (3 as nsIFilePicker.Mode),
  );
  const imagePatterns = "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.tif;*.tiff;*.bmp";
  picker.appendFilter("PDF or Images", `*.pdf;${imagePatterns}`);
  picker.appendFilter("PDF", "*.pdf");
  picker.appendFilter("Images", imagePatterns);

  const result = await openFilePicker(picker);
  if (result !== picker.returnOK) {
    return { status: "cancelled" };
  }

  const attachments = getSelectedFiles(picker).map((file) => {
    const path = file.path;
    if (!path) {
      throw new Error("Selected attachment does not expose an absolute path.");
    }
    const attachment = createLocalAttachmentRef(path);
    if (!attachment) {
      throw new Error(`Unsupported attachment type: ${path}`);
    }
    return attachment;
  });
  if (!attachments.length) {
    return { status: "cancelled" };
  }
  return { status: "selected", attachments };
}

function getSelectedFiles(
  picker: nsIFilePicker,
): Array<nsIFile & { path?: string }> {
  const selected: Array<nsIFile & { path?: string }> = [];
  const files = picker.files;
  while (files.hasMoreElements()) {
    const item = files.getNext();
    if (!item.QueryInterface) {
      throw new Error("Selected attachment is not an XPCOM file object.");
    }
    selected.push(
      item.QueryInterface(getComponents().interfaces.nsIFile) as nsIFile & {
        path?: string;
      },
    );
  }
  return selected;
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
  if (!mimeType) {
    return null;
  }
  return {
    id: createAttachmentId(path),
    path,
    filename,
    kind: "image",
    mimeType,
  };
}

function createAttachmentId(path: string): string {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 31 + path.charCodeAt(index)) >>> 0;
  }
  return `local-${hash.toString(36)}-${Date.now().toString(36)}`;
}

function createFilePicker(): nsIFilePicker {
  const components = getComponents();
  const classes = components.classes as unknown as Record<
    string,
    { createInstance: (iid: nsJSIID<nsIFilePicker>) => nsIFilePicker }
  >;
  return classes["@mozilla.org/filepicker;1"]!.createInstance(
    components.interfaces.nsIFilePicker,
  );
}

function getComponents(): typeof Components {
  return (
    globalThis as typeof globalThis & {
      Components: typeof Components;
    }
  ).Components;
}

function openFilePicker(picker: nsIFilePicker): Promise<number> {
  return new Promise((resolve) => {
    picker.open({
      done(result: number) {
        resolve(result);
      },
    });
  });
}
