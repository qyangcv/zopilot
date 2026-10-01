import { assert } from "chai";
import {
  copyRegionImage,
  getImageAnnotationTarget,
} from "../../src/integrations/zotero/ZoteroAnnotationService.ts";

describe("Zotero annotation region service", function () {
  afterEach(function () {
    delete (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero;
  });

  it("accepts only image annotations belonging to the current reader attachment", function () {
    const image = createAnnotation({
      id: 20,
      key: "ANN-IMAGE",
      annotationType: "image",
      annotationPageLabel: "7",
      annotationPosition: JSON.stringify({ pageIndex: 7 }),
    });
    const highlight = createAnnotation({
      id: 21,
      key: "ANN-HIGHLIGHT",
      annotationType: "highlight",
    });
    const attachment = createAttachment([image, highlight]);
    installZoteroMock(attachment, image, highlight);

    const target = getImageAnnotationTarget(
      { itemID: attachment.id, type: "pdf" } as _ZoteroTypes.ReaderInstance,
      image.key,
    );

    assert.deepEqual(target, {
      id: "region:1:ANN-IMAGE",
      key: "ANN-IMAGE",
      libraryID: 1,
      attachmentItemID: 10,
      attachmentKey: "PDF-KEY",
      pageLabel: "7",
      title: "Paper PDF",
      pageIndex: 7,
    });
    assert.isUndefined(
      getImageAnnotationTarget(
        { itemID: attachment.id, type: "pdf" } as _ZoteroTypes.ReaderInstance,
        highlight.key,
      ),
    );
  });

  it("copies the cache image into the profile region directory", async function () {
    const image = createAnnotation({
      id: 20,
      key: "ANN-IMAGE",
      annotationType: "image",
      annotationPosition: JSON.stringify({ pageIndex: 1 }),
    });
    const attachment = createAttachment([image]);
    installZoteroMock(attachment, image);
    const writes: Array<{ path: string; bytes: Uint8Array }> = [];
    const target = getImageAnnotationTarget(
      { itemID: attachment.id, type: "pdf" } as _ZoteroTypes.ReaderInstance,
      image.key,
    );
    assert.isDefined(target);
    if (!target) return;

    const result = await copyRegionImage(target, {
      profileDir: "/profile",
      join: (...parts) => parts.join("/"),
      exists: async (path) => path.startsWith("/cache/"),
      read: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      makeDirectory: async () => undefined,
      write: async (path, bytes) => writes.push({ path, bytes }),
      stat: async () => ({ size: 8 }),
    });

    assert.deepInclude(result, {
      id: "local-region:1:ANN-IMAGE-4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
      filename:
        "region-1-ANN-IMAGE-4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6.png",
      path: "/profile/zopilot/attachments/regions/region-1-ANN-IMAGE-4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6.png",
      mimeType: "image/png",
      kind: "image",
    });
    assert.deepEqual(writes, [
      {
        path: "/profile/zopilot/attachments/regions/region-1-ANN-IMAGE-4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6.png",
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      },
    ]);
  });
});

type TestAnnotation = {
  id: number;
  key: string;
  libraryID: number;
  parentID: number;
  annotationType: string;
  annotationPageLabel?: string;
  annotationPosition?: string;
  isAnnotation: () => boolean;
};

type TestAttachment = {
  id: number;
  key: string;
  libraryID: number;
  getField: (field: string) => string;
  getAnnotations: () => TestAnnotation[];
  isPDFAttachment: () => boolean;
};

function createAnnotation(
  options: Pick<TestAnnotation, "id" | "key" | "annotationType"> & {
    annotationPageLabel?: string;
  },
): TestAnnotation {
  return {
    ...options,
    libraryID: 1,
    parentID: 10,
    isAnnotation: () => true,
  };
}

function createAttachment(annotations: TestAnnotation[]): TestAttachment {
  return {
    id: 10,
    key: "PDF-KEY",
    libraryID: 1,
    getField: (field) => (field === "title" ? "Paper PDF" : ""),
    getAnnotations: () => annotations,
    isPDFAttachment: () => true,
  };
}

function installZoteroMock(
  attachment: TestAttachment,
  ...annotations: TestAnnotation[]
): void {
  const items = new Map<number, TestAttachment | TestAnnotation>([
    [attachment.id, attachment],
    ...annotations.map((annotation) => [annotation.id, annotation] as const),
  ]);
  const byKey = new Map(
    [attachment, ...annotations].map((item) => [item.key, item]),
  );
  (
    globalThis as typeof globalThis & {
      Zotero: unknown;
    }
  ).Zotero = {
    Items: {
      get: (id: number) => items.get(id),
      getByLibraryAndKey: (_libraryID: number, key: string) =>
        byKey.get(key) || false,
    },
    Annotations: {
      getCacheImagePath: (annotation: { key: string }) =>
        `/cache/${annotation.key}.png`,
    },
  };
}
