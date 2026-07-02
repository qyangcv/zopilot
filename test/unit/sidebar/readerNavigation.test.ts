import { assert } from "chai";
import {
  extractReaderLocators,
  navigateReaderLocator,
  readerLocatorToLocation,
} from "../../../src/modules/sidebar/readerNavigation.ts";

describe("sidebar reader navigation", function () {
  it("extracts page and annotation locators from assistant text", function () {
    const locators = extractReaderLocators(
      "The method is introduced on p. 12 and page 13. annotation: ABCD1234 is relevant.",
    );

    assert.deepEqual(locators, [
      { kind: "page", page: 12, label: "p. 12" },
      { kind: "page", page: 13, label: "p. 13" },
      {
        kind: "annotation",
        annotationKey: "ABCD1234",
        label: "annotation ABCD1234",
      },
    ]);
  });

  it("converts page locators to Zotero zero-based reader locations", function () {
    assert.deepEqual(
      readerLocatorToLocation({ kind: "page", page: 7, label: "p. 7" }),
      {
        pageIndex: 6,
        pageLabel: "7",
      },
    );
  });

  it("navigates an existing reader before falling back to opening a tab", async function () {
    let navigated: unknown;
    let focused = false;
    const reader = {
      type: "pdf",
      navigate: async (location: unknown) => {
        navigated = location;
      },
      focus: () => {
        focused = true;
      },
    };

    const opened = await navigateReaderLocator(
      createWindow(),
      { kind: "page", page: 3, label: "p. 3" },
      { reader: reader as _ZoteroTypes.ReaderInstance },
    );

    assert.isTrue(opened);
    assert.deepEqual(navigated, { pageIndex: 2, pageLabel: "3" });
    assert.isTrue(focused);
  });
});

function createWindow(): Window {
  return {} as Window;
}
