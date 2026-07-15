import { assert } from "chai";
import { pickLocalAttachment } from "../../../src/features/sidebar/context/attachmentUpload.ts";

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
      files: ["/tmp/paper.pdf"],
    });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.equal(result.status, "selected");
    assert.deepInclude(result.status === "selected" && result.attachments[0], {
      path: "/tmp/paper.pdf",
      filename: "paper.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
    });
  });

  it("returns common images as local attachment paths", async function () {
    const picker = createPicker({
      result: 0,
      files: ["/tmp/figure.jpeg"],
    });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.equal(result.status, "selected");
    assert.deepInclude(result.status === "selected" && result.attachments[0], {
      path: "/tmp/figure.jpeg",
      filename: "figure.jpeg",
      kind: "image",
      mimeType: "image/jpeg",
    });
  });

  it("returns every file selected in multi-select mode", async function () {
    const picker = createPicker({
      result: 0,
      files: ["/tmp/paper.pdf", "/tmp/figure.png"],
    });

    const result = await pickLocalAttachment({
      win: createWindow(),
      deps: {
        createFilePicker: () => picker,
      },
    });

    assert.equal(picker.initializedMode, picker.modeOpenMultiple);
    assert.deepEqual(
      result.status === "selected"
        ? result.attachments.map((attachment) => attachment.path)
        : [],
      ["/tmp/paper.pdf", "/tmp/figure.png"],
    );
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

type FakeFilePicker = {
  modeOpenMultiple: number;
  returnOK: number;
  files: string[];
  init(win: Window, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show(): Promise<number>;
  appendedFilters: Array<{ title: string; pattern: string }>;
  initializedMode?: number;
};

function createPicker({
  files = [],
  result,
}: {
  files?: string[];
  result: number;
}): FakeFilePicker {
  const appendedFilters: Array<{ title: string; pattern: string }> = [];
  const picker = {
    modeOpenMultiple: 3,
    returnOK: 0,
    files,
    init: (_win: Window, _title: string, mode: number) => {
      picker.initializedMode = mode;
    },
    appendFilter(title: string, pattern: string) {
      appendedFilters.push({ title, pattern });
    },
    appendedFilters,
    async show() {
      return result;
    },
  } as FakeFilePicker;
  return picker;
}

function createWindow(): Window {
  return {} as Window;
}

function installLocaleMock(): void {
  const runtime = globalThis as typeof globalThis & {
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
  };
  runtime.addon = {
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
