import { assert } from "chai";
import { pickLocalAttachment } from "../../../src/modules/sidebar/attachmentUpload.ts";

describe("sidebar attachment upload", function () {
  before(function () {
    installLocaleMock();
  });

  it("returns cancelled when the Zotero file picker is cancelled", async function () {
    const picker = createPicker({ result: 1 });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.deepEqual(result, { status: "cancelled" });
  });

  it("returns the chosen PDF as a local attachment path", async function () {
    const picker = createPicker({
      result: 0,
      file: { path: "/tmp/paper.pdf" },
    });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.equal(result.status, "selected");
    assert.deepInclude(result.status === "selected" && result.attachment, {
      path: "/tmp/paper.pdf",
      filename: "paper.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
    });
  });

  it("returns common images as local attachment paths", async function () {
    const picker = createPicker({
      result: 0,
      file: { path: "/tmp/figure.jpeg" },
    });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.equal(result.status, "selected");
    assert.deepInclude(result.status === "selected" && result.attachment, {
      path: "/tmp/figure.jpeg",
      filename: "figure.jpeg",
      kind: "image",
      mimeType: "image/jpeg",
    });
  });

  it("uses a combined default picker filter so images are selectable immediately", async function () {
    const picker = createPicker({
      result: 1,
    });

    await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.deepEqual(picker.appendedFilters[0], {
      title: "PDF or Images",
      pattern: "*.pdf;*.png;*.jpg;*.jpeg;*.gif;*.webp;*.tif;*.tiff;*.bmp",
    });
  });
});

type FakeFilePicker = nsIFilePicker & {
  appendedFilters: Array<{ title: string; pattern: string }>;
};

function createPicker({
  file,
  result,
}: {
  file?: unknown;
  result: number;
}): FakeFilePicker {
  const appendedFilters: Array<{ title: string; pattern: string }> = [];
  return {
    modeOpen: 0,
    returnOK: 0,
    filterPDF: 1024,
    file,
    init: () => undefined,
    appendFilters: () => undefined,
    appendFilter(title: string, pattern: string) {
      appendedFilters.push({ title, pattern });
    },
    appendedFilters,
    open(callback: { done: (result: number) => void }) {
      callback.done(result);
    },
  } as unknown as FakeFilePicker;
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
