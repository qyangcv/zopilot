import { assert } from "chai";
import { registerReaderRegionMenu } from "../../src/integrations/zotero/readerRegionMenu.ts";

describe("Reader region menu", function () {
  afterEach(function () {
    delete (globalThis as typeof globalThis & { Zotero?: unknown }).Zotero;
    delete (globalThis as typeof globalThis & { addon?: unknown }).addon;
  });

  it("adds a menu item for image annotations and unregisters it", function () {
    const registeredHandlers = new Map<string, Function>();
    let unregisterCount = 0;
    const image = {
      id: 20,
      key: "ANN-IMAGE",
      libraryID: 1,
      parentID: 10,
      annotationType: "image",
      annotationPosition: JSON.stringify({ pageIndex: 1 }),
      isAnnotation: () => true,
    };
    const attachment = {
      id: 10,
      key: "PDF-KEY",
      libraryID: 1,
      getField: () => "Paper PDF",
      getAnnotations: () => [image],
      isPDFAttachment: () => true,
    };
    installLocaleMock();
    (
      globalThis as typeof globalThis & {
        Zotero: unknown;
      }
    ).Zotero = {
      Items: {
        get: (id: number) => (id === 10 ? attachment : image),
        getByLibraryAndKey: () => image,
      },
      Reader: {
        registerEventListener: (_type: string, handler: Function) => {
          registeredHandlers.set(_type, handler);
        },
        unregisterEventListener: () => {
          unregisterCount += 1;
        },
      },
    };
    const dispose = registerReaderRegionMenu(() => undefined);
    const registeredHandler = registeredHandlers.get(
      "createAnnotationContextMenu",
    );
    assert.isDefined(registeredHandler);
    if (!registeredHandler) return;

    let menu: { label: string } | undefined;
    registeredHandler({
      reader: { itemID: 10, type: "pdf" } as _ZoteroTypes.ReaderInstance,
      doc: {} as Document,
      params: { ids: ["ANN-IMAGE"], x: 0, y: 0 },
      append: (item) => {
        menu = item;
      },
      type: "createAnnotationContextMenu",
    });

    assert.equal(menu?.label, "zopilot-reader-ask-about-region");
    const viewMenu: Array<{ label: string }> = [];
    const viewHandler = registeredHandlers.get("createViewContextMenu");
    assert.isDefined(viewHandler);
    viewHandler?.({
      reader: {
        itemID: 10,
        type: "pdf",
        _internalReader: {
          _state: { selectedAnnotationIDs: ["ANN-IMAGE"] },
        },
      } as _ZoteroTypes.ReaderInstance,
      doc: {} as Document,
      params: { x: 0, y: 0 },
      append: (item: { label: string }) => viewMenu.push({ label: item.label }),
      type: "createViewContextMenu",
    });
    assert.deepEqual(viewMenu, [{ label: "zopilot-reader-ask-about-region" }]);
    dispose();
    assert.equal(unregisterCount, 2);
  });
});

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: unknown;
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: (messages: Array<{ id: string }>) =>
            messages.map((message) => ({ value: message.id })),
        },
      },
    },
  };
}
