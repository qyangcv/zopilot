import { getString } from "../../utils/locale";

export { pickAndImportAttachment };
export type { AttachmentUploadResult, FilePickerDependencies };

type AttachmentUploadResult =
  | { status: "cancelled" }
  | { status: "imported"; item: Zotero.Item };

type FilePickerDependencies = {
  createFilePicker?: () => nsIFilePicker;
  importFromFile?: typeof Zotero.Attachments.importFromFile;
};

async function pickAndImportAttachment({
  libraryID,
  parentItemID,
  win,
  deps = {},
}: {
  libraryID: number;
  parentItemID?: number;
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
    0 as nsIFilePicker["mode"],
  );
  if (picker.filterPDF) {
    picker.appendFilters(picker.filterPDF);
  } else {
    picker.appendFilter("PDF", "*.pdf");
  }

  const result = await openFilePicker(picker);
  if (result !== picker.returnOK || !picker.file) {
    return { status: "cancelled" };
  }

  const options = {
    file: picker.file,
    libraryID,
    parentItemID,
    contentType: "application/pdf",
  };
  const item = deps.importFromFile
    ? await deps.importFromFile(options)
    : await Zotero.Attachments.importFromFile.call(Zotero.Attachments, options);
  return { status: "imported", item };
}

function createFilePicker(): nsIFilePicker {
  const components = (
    globalThis as typeof globalThis & {
      Components: typeof Components;
    }
  ).Components;
  const classes = components.classes as unknown as Record<
    string,
    { createInstance: (iid: nsJSIID<nsIFilePicker>) => nsIFilePicker }
  >;
  return classes["@mozilla.org/filepicker;1"]!.createInstance(
    components.interfaces.nsIFilePicker,
  );
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
