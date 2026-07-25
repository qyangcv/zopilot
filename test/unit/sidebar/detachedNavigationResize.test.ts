import { assert } from "chai";
import {
  DETACHED_MAIN_MIN_WIDTH,
  DETACHED_NAVIGATION_MAX_WIDTH,
  DETACHED_NAVIGATION_MIN_WIDTH,
  clampDetachedNavigationWidth,
  resolveDetachedNavigationMaxWidth,
} from "../../../src/features/sidebar/ui/DetachedWindowNavigationResizer.tsx";

describe("detached navigation resize", function () {
  it("clamps navigation width to its absolute bounds", function () {
    assert.equal(
      clampDetachedNavigationWidth(120, 980),
      DETACHED_NAVIGATION_MIN_WIDTH,
    );
    assert.equal(clampDetachedNavigationWidth(300, 980), 300);
    assert.equal(
      clampDetachedNavigationWidth(520, 980),
      DETACHED_NAVIGATION_MAX_WIDTH,
    );
  });

  it("preserves the minimum main content width in narrow windows", function () {
    const rootWidth = 640;
    const expectedMaximum = rootWidth - DETACHED_MAIN_MIN_WIDTH;

    assert.equal(resolveDetachedNavigationMaxWidth(rootWidth), expectedMaximum);
    assert.equal(clampDetachedNavigationWidth(400, rootWidth), expectedMaximum);
  });

  it("falls back safely when the root cannot be measured", function () {
    assert.equal(
      resolveDetachedNavigationMaxWidth(Number.NaN),
      DETACHED_NAVIGATION_MAX_WIDTH,
    );
    assert.equal(clampDetachedNavigationWidth(Number.NaN, 980), 232);
  });
});
