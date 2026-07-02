import { assert } from "chai";
import { pickAndImportAttachment } from "../../../src/modules/sidebar/attachmentUpload.ts";

describe("sidebar attachment upload", function () {
  before(function () {
    installLocaleMock();
  });

  it("returns cancelled when the Zotero file picker is cancelled", async function () {
    const picker = createPicker({ result: 1 });

    const result = await pickAndImportAttachment({
      libraryID: 1,
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
        importFromFile: async () => {
          throw new Error("should not import cancelled file");
        },
      },
    });

    assert.deepEqual(result, { status: "cancelled" });
  });

  it("imports the chosen PDF into the active Zotero parent item", async function () {
    const picker = createPicker({
      result: 0,
      file: { path: "/tmp/paper.pdf" },
    });
    let importedOptions: Record<string, unknown> | undefined;

    const result = await pickAndImportAttachment({
      libraryID: 3,
      parentItemID: 42,
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
        importFromFile: async (options: Record<string, unknown>) => {
          importedOptions = options;
          return { id: 9 } as Zotero.Item;
        },
      },
    });

    assert.equal(result.status, "imported");
    assert.deepInclude(importedOptions, {
      file: picker.file,
      libraryID: 3,
      parentItemID: 42,
      contentType: "application/pdf",
    });
  });
});

function createPicker({
  file,
  result,
}: {
  file?: unknown;
  result: number;
}): nsIFilePicker {
  return {
    modeOpen: 0,
    returnOK: 0,
    filterPDF: 1024,
    file,
    init: () => undefined,
    appendFilters: () => undefined,
    appendFilter: () => undefined,
    open(callback: { done: (result: number) => void }) {
      callback.done(result);
    },
  } as unknown as nsIFilePicker;
}

function createWindow(): Window {
  return {
    browsingContext: {},
  } as unknown as Window;
}

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                messages: Array<{ id: string }>,
              ) => Array<{ value: string }>;
            };
          };
        };
      };
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}
