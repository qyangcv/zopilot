import { assert } from "chai";
import {
  canReadSidebarDrop,
  parseZoteroItemIDs,
  readSidebarDropPayload,
} from "../../../src/integrations/zotero/compat/dragData.ts";

describe("sidebar drag data compatibility", function () {
  it("parses Zotero item IDs in order and removes duplicates", function () {
    assert.deepEqual(parseZoteroItemIDs("12,7,12 bad -1 9"), [12, 7, 9]);
  });

  it("prioritizes Zotero item data over file flavors", function () {
    const payload = readSidebarDropPayload(
      createDataTransfer({
        types: ["zotero/item", "application/x-moz-file"],
        zoteroItems: "12,7",
        files: [createNativeFile("/tmp/wrong.pdf")],
      }),
    );

    assert.deepEqual(payload, {
      kind: "zotero-items",
      itemIDs: [12, 7],
    });
  });

  it("does not fall back to a file when Zotero item data is invalid", function () {
    const payload = readSidebarDropPayload(
      createDataTransfer({
        types: ["zotero/item", "application/x-moz-file"],
        zoteroItems: "invalid",
        files: [createNativeFile("/tmp/wrong.pdf")],
      }),
    );

    assert.isUndefined(payload);
  });

  it("reads native file paths while skipping directories and missing files", function () {
    const payload = readSidebarDropPayload(
      createDataTransfer({
        types: ["application/x-moz-file"],
        files: [
          createNativeFile("/tmp/paper.pdf"),
          createNativeFile("/tmp/folder", { directory: true }),
          createNativeFile("/tmp/missing.png", { exists: false }),
          createNativeFile("/tmp/paper.pdf"),
          createNativeFile("/tmp/figure.png"),
        ],
      }),
    );

    assert.deepEqual(payload, {
      kind: "local-files",
      paths: ["/tmp/paper.pdf", "/tmp/figure.png"],
    });
  });

  it("queries macOS Finder entries as nsIFile before reading their paths", function () {
    const globals = globalThis as typeof globalThis & {
      Components?: unknown;
    };
    const previousComponents = globals.Components;
    const nsIFile = {};
    globals.Components = { interfaces: { nsIFile } };

    try {
      const payload = readSidebarDropPayload(
        createDataTransfer({
          types: ["Files", "application/x-moz-file"],
          files: [
            {
              QueryInterface(interfaceType: unknown) {
                assert.equal(interfaceType, nsIFile);
                return createNativeFile("/Users/me/Desktop/paper.pdf");
              },
            },
          ],
        }),
      );

      assert.deepEqual(payload, {
        kind: "local-files",
        paths: ["/Users/me/Desktop/paper.pdf"],
      });
    } finally {
      if (previousComponents === undefined) {
        delete globals.Components;
      } else {
        globals.Components = previousComponents;
      }
    }
  });

  it("recovers escaped macOS Finder paths using Zotero's file API", function () {
    const globals = globalThis as typeof globalThis & {
      Zotero?: unknown;
    };
    const previousZotero = globals.Zotero;
    globals.Zotero = {
      isMac: true,
      File: {
        pathToFile(path: string) {
          assert.equal(path, "/Users/me/Desktop/Figure[1].png");
          return createNativeFile(path);
        },
      },
    };

    try {
      const payload = readSidebarDropPayload(
        createDataTransfer({
          types: ["application/x-moz-file"],
          files: [
            createNativeFile("/Users/me/Desktop/Figure%5B1%5D.png", {
              exists: false,
            }),
          ],
        }),
      );

      assert.deepEqual(payload, {
        kind: "local-files",
        paths: ["/Users/me/Desktop/Figure[1].png"],
      });
    } finally {
      if (previousZotero === undefined) {
        delete globals.Zotero;
      } else {
        globals.Zotero = previousZotero;
      }
    }
  });

  it("ignores plain text and reports only supported drag flavors", function () {
    const textDrop = createDataTransfer({ types: ["text/plain"] });

    assert.isFalse(canReadSidebarDrop(textDrop));
    assert.isUndefined(readSidebarDropPayload(textDrop));
    assert.isTrue(
      canReadSidebarDrop(
        createDataTransfer({ types: ["application/x-moz-file"] }),
      ),
    );
  });
});

function createDataTransfer({
  files = [],
  types,
  zoteroItems = "",
}: {
  files?: unknown[];
  types: string[];
  zoteroItems?: string;
}): DataTransfer {
  return {
    files: [],
    getData(format: string) {
      return format === "zotero/item" ? zoteroItems : "";
    },
    mozGetDataAt(_format: string, index: number) {
      return files[index];
    },
    mozItemCount: files.length,
    types,
  } as unknown as DataTransfer;
}

function createNativeFile(
  path: string,
  options: { directory?: boolean; exists?: boolean } = {},
) {
  return {
    path,
    exists: () => options.exists !== false,
    isDirectory: () => Boolean(options.directory),
    isFile: () => !options.directory,
  };
}
