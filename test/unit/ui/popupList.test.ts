import { assert } from "chai";
import {
  constrainPopupActiveIndex,
  findPopupEdgeIndex,
  findPopupNextIndex,
} from "../../../src/ui/primitives/PopupList.tsx";

describe("popup list navigation", function () {
  const disabled = new Set([0, 2]);
  const isDisabled = (index: number) => disabled.has(index);

  it("wraps in both directions while skipping disabled rows", function () {
    assert.equal(findPopupNextIndex(4, 3, 1, isDisabled), 1);
    assert.equal(findPopupNextIndex(4, 1, -1, isDisabled), 3);
  });

  it("resolves Home and End to the first and last enabled rows", function () {
    assert.equal(findPopupEdgeIndex(4, isDisabled, "first"), 1);
    assert.equal(findPopupEdgeIndex(4, isDisabled, "last"), 3);
  });

  it("keeps a valid active row and converges after dynamic deletion", function () {
    assert.equal(constrainPopupActiveIndex(4, 3, isDisabled), 3);
    assert.equal(constrainPopupActiveIndex(3, 3, isDisabled), 1);
    assert.equal(constrainPopupActiveIndex(0, 0, isDisabled), -1);
  });

  it("stops at an edge when looping is disabled", function () {
    assert.equal(findPopupNextIndex(4, 3, 1, isDisabled, false), 3);
    assert.equal(findPopupNextIndex(4, 1, -1, isDisabled, false), 1);
  });
});
