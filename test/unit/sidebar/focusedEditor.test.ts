import { assert } from "chai";
import { blurFocusedDescendant } from "../../../src/features/sidebar/host/focusedEditor.ts";

describe("sidebar focused editor lifecycle", function () {
  it("blurs a focused descendant before its host is moved or removed", function () {
    let blurCount = 0;
    const activeElement = {
      blur: () => blurCount++,
    } as Element & { blur: () => void };
    const root = createRoot(activeElement, activeElement);

    assert.isTrue(blurFocusedDescendant(root));
    assert.equal(blurCount, 1);
  });

  it("does not disturb focus outside the host", function () {
    let blurCount = 0;
    const activeElement = {
      blur: () => blurCount++,
    } as Element & { blur: () => void };
    const root = createRoot(activeElement, {} as Element);

    assert.isFalse(blurFocusedDescendant(root));
    assert.equal(blurCount, 0);
  });
});

function createRoot(activeElement: Element, descendant: Element): Element {
  return {
    contains: (element: Node | null) => element === descendant,
    ownerDocument: { activeElement },
  } as unknown as Element;
}
