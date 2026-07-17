import { assert } from "chai";
import { shouldLoadReaderItemContextTree } from "../../../src/features/sidebar/workspace/WorkspaceCoordinator";

describe("WorkspaceCoordinator item context tree mode", function () {
  it("loads only for Reader item workspaces", function () {
    assert.isTrue(
      shouldLoadReaderItemContextTree(
        { kind: "reader", itemID: 1, tabID: "reader-tab" },
        "item",
      ),
    );
    assert.isFalse(
      shouldLoadReaderItemContextTree(
        { kind: "library", rowID: "library-row" },
        "item",
      ),
    );
    assert.isFalse(
      shouldLoadReaderItemContextTree(
        { kind: "reader", itemID: 1, tabID: "reader-tab" },
        "collection",
      ),
    );
    assert.isFalse(shouldLoadReaderItemContextTree(undefined, "item"));
  });
});
