import { assert } from "chai";
import {
  findClipboardImageItem,
  MAX_CLIPBOARD_IMAGE_BYTES,
  persistClipboardImage,
} from "../../../src/features/sidebar/context/clipboardAttachment.ts";

describe("clipboard image attachments", function () {
  it("finds supported image clipboard items and ignores text", function () {
    const text = { kind: "string", type: "text/plain" } as DataTransferItem;
    const image = { kind: "file", type: "image/png" } as DataTransferItem;

    assert.strictEqual(
      findClipboardImageItem([text, image] as unknown as DataTransferItemList),
      image,
    );
    assert.isUndefined(
      findClipboardImageItem([text] as unknown as DataTransferItemList),
    );
  });

  it("persists an image below the Zotero profile and returns a local ref", async function () {
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const directories: string[] = [];
    const result = await persistClipboardImage(
      new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      "image/jpeg",
      {
        profileDir: "/profile",
        createId: () => "clipboard-test",
        join: (...parts) => parts.join("/"),
        makeDirectory: async (path) => {
          directories.push(path);
        },
        write: async (path, bytes) => {
          writes.push({ path, bytes });
        },
      },
    );

    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    assert.deepEqual(directories, ["/profile/zopilot/attachments/clipboard"]);
    assert.deepEqual(writes, [
      {
        path: "/profile/zopilot/attachments/clipboard/clipboard-test.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ]);
    assert.deepInclude(result.attachment, {
      id: "local-clipboard-test",
      path: "/profile/zopilot/attachments/clipboard/clipboard-test.jpg",
      filename: "clipboard-test.jpg",
      kind: "image",
      mimeType: "image/jpeg",
    });
  });

  it("rejects unsupported formats and oversized clipboard images", async function () {
    const unsupported = await persistClipboardImage(
      new Blob(["text"], { type: "image/tiff" }),
      "image/tiff",
      { createId: () => "unsupported" },
    );
    assert.deepEqual(unsupported, {
      status: "ignored",
      reason: "unsupported-type",
    });

    const oversized = await persistClipboardImage(
      {
        size: MAX_CLIPBOARD_IMAGE_BYTES + 1,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Blob,
      "image/png",
      { createId: () => "oversized" },
    );
    assert.deepEqual(oversized, { status: "rejected", reason: "too-large" });
  });

  it("cleans up a partial file when writing fails", async function () {
    const removed: string[] = [];
    const result = await persistClipboardImage(
      new Blob([new Uint8Array([1])], { type: "image/png" }),
      "image/png",
      {
        profileDir: "/profile",
        createId: () => "failed",
        join: (...parts) => parts.join("/"),
        makeDirectory: async () => undefined,
        write: async () => {
          throw new Error("disk full");
        },
        remove: async (path) => {
          removed.push(path);
        },
      },
    );

    assert.deepEqual(result, { status: "rejected", reason: "write-failed" });
    assert.deepEqual(removed, [
      "/profile/zopilot/attachments/clipboard/failed.png",
    ]);
  });
});
