import { assert } from "chai";
import { calculateFloatingPosition } from "../../../src/ui/primitives/floatingPosition.ts";

describe("floating popover positioning", function () {
  it("anchors a select popup above the trigger and aligns its leading edge", function () {
    const position = calculateFloatingPosition({
      align: "start",
      anchorRect: rect({ bottom: 582, left: 300, right: 360, top: 560 }),
      maxWidth: 280,
      minWidth: 160,
      preferredSide: "above",
      rootRect: rect({ bottom: 600, left: 0, right: 400, top: 0 }),
    });

    assert.equal(position.side, "above");
    assert.equal(position.width, 160);
    assert.equal(position.left, 232);
    assert.equal(position.bottom, 46);
  });

  it("keeps a popup inside the portal margin when a start-aligned trigger is near the right edge", function () {
    const position = calculateFloatingPosition({
      align: "start",
      anchorRect: rect({ bottom: 582, left: 360, right: 390, top: 560 }),
      maxWidth: 280,
      minWidth: 160,
      preferredSide: "above",
      rootRect: rect({ bottom: 600, left: 0, right: 400, top: 0 }),
    });

    assert.equal(position.left, 232);
  });

  it("opens below when the preferred side has too little room", function () {
    const position = calculateFloatingPosition({
      anchorRect: rect({ bottom: 42, left: 80, right: 140, top: 20 }),
      preferredSide: "above",
      rootRect: rect({ bottom: 220, left: 0, right: 320, top: 0 }),
    });

    assert.equal(position.side, "below");
    assert.equal(position.top, 48);
    assert.equal(position.maxHeight, 164);
  });

  it("stretches an input-anchored popup to the textarea width", function () {
    const position = calculateFloatingPosition({
      align: "stretch",
      anchorRect: rect({ bottom: 520, left: 24, right: 376, top: 470 }),
      maxWidth: 720,
      minWidth: 0,
      preferredSide: "above",
      rootRect: rect({ bottom: 600, left: 0, right: 400, top: 0 }),
    });

    assert.equal(position.width, 352);
    assert.equal(position.left, 24);
  });

  it("shrinks a popup to a narrow horizontal boundary", function () {
    const position = calculateFloatingPosition({
      anchorRect: rect({ bottom: 580, left: 100, right: 240, top: 558 }),
      horizontalBoundaryRect: rect({
        bottom: 600,
        left: 90,
        right: 390,
        top: 0,
      }),
      horizontalMargin: 0,
      maxWidth: 420,
      minWidth: 0,
      rootRect: rect({ bottom: 600, left: 0, right: 800, top: 0 }),
      width: 420,
    });

    assert.equal(position.width, 300);
    assert.equal(position.left, 90);
  });

  it("keeps a content-sized model popup between its preferred bounds", function () {
    const wide = calculateFloatingPosition({
      anchorRect: rect({ bottom: 580, left: 100, right: 180, top: 558 }),
      horizontalBoundaryRect: rect({
        bottom: 600,
        left: 20,
        right: 420,
        top: 0,
      }),
      horizontalMargin: 0,
      maxWidth: 300,
      minWidth: 260,
      rootRect: rect({ bottom: 600, left: 0, right: 440, top: 0 }),
      width: 280,
    });
    const narrow = calculateFloatingPosition({
      anchorRect: rect({ bottom: 580, left: 40, right: 120, top: 558 }),
      horizontalBoundaryRect: rect({
        bottom: 600,
        left: 20,
        right: 260,
        top: 0,
      }),
      horizontalMargin: 0,
      maxWidth: 300,
      minWidth: 260,
      rootRect: rect({ bottom: 600, left: 0, right: 280, top: 0 }),
      width: 280,
    });

    assert.equal(wide.width, 280);
    assert.equal(narrow.width, 240);
  });

  it("keeps an end-aligned header popup inside the sidebar boundary", function () {
    const position = calculateFloatingPosition({
      align: "end",
      anchorRect: rect({ bottom: 70, left: 610, right: 638, top: 42 }),
      horizontalBoundaryRect: rect({
        bottom: 700,
        left: 390,
        right: 750,
        top: 20,
      }),
      maxWidth: 420,
      minWidth: 240,
      preferredSide: "below",
      rootRect: rect({ bottom: 800, left: 0, right: 900, top: 0 }),
      width: 300,
    });

    assert.equal(position.width, 300);
    assert.equal(position.left, 398);
    assert.isAtLeast(position.left, 390);
    assert.isAtMost(position.left + position.width, 750);
  });

  it("grows within a wide boundary up to the configured maximum", function () {
    const position = calculateFloatingPosition({
      anchorRect: rect({ bottom: 580, left: 100, right: 240, top: 558 }),
      horizontalBoundaryRect: rect({
        bottom: 600,
        left: 90,
        right: 690,
        top: 0,
      }),
      horizontalMargin: 0,
      maxWidth: 420,
      minWidth: 0,
      rootRect: rect({ bottom: 600, left: 0, right: 800, top: 0 }),
      width: 420,
    });

    assert.equal(position.width, 420);
    assert.equal(position.left, 100);
  });

  it("limits a popup to the bottom edge of the sidebar header", function () {
    const position = calculateFloatingPosition({
      anchorRect: rect({ bottom: 780, left: 100, right: 240, top: 758 }),
      preferredSide: "above",
      rootRect: rect({ bottom: 800, left: 0, right: 800, top: 0 }),
      topBoundary: 98,
    });

    assert.equal(position.side, "above");
    assert.equal(position.maxHeight, 646);
  });
});

function rect({
  bottom,
  left,
  right,
  top,
}: {
  bottom: number;
  left: number;
  right: number;
  top: number;
}) {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}
