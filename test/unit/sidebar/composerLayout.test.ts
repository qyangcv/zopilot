import { assert } from "chai";
import {
  requestTextareaResize,
  resizeTextarea,
} from "../../../src/features/sidebar/ui/composerLayout.ts";

describe("sidebar composer elastic layout", function () {
  it("grows with content below the host-relative cap", function () {
    const fixture = createTextareaFixture({
      hostHeight: 500,
      scrollHeight: 120,
    });

    resizeTextarea(fixture.textarea);

    assert.deepEqual(fixture.style, {
      height: "120px",
      maxHeight: "210px",
    });
    assert.deepEqual(fixture.measuredAtHeights, ["0px"]);
    assert.equal(fixture.closestSelector, ".zp-sidebar");
  });

  it("caps long content and enables internal scrolling", function () {
    const fixture = createTextareaFixture({
      hostHeight: 1_000,
      scrollHeight: 900,
    });

    resizeTextarea(fixture.textarea);

    assert.deepEqual(fixture.style, {
      height: "420px",
      maxHeight: "420px",
    });
  });

  it("keeps a usable cap in a short or unavailable host", function () {
    const shortHost = createTextareaFixture({
      hostHeight: 100,
      scrollHeight: 200,
    });
    const missingHost = createTextareaFixture({
      hostHeight: null,
      scrollHeight: 300,
    });

    resizeTextarea(shortHost.textarea);
    resizeTextarea(missingHost.textarea);

    assert.equal(shortHost.style.maxHeight, "140px");
    assert.equal(shortHost.style.height, "140px");
    assert.equal(missingHost.style.maxHeight, "285px");
    assert.equal(missingHost.style.height, "285px");
  });

  it("defers and coalesces focused native resize requests", function () {
    const fixture = createTextareaFixture({
      hostHeight: 500,
      scrollHeight: 120,
    });

    requestTextareaResize(fixture.textarea);
    fixture.scrollHeight = 180;
    requestTextareaResize(fixture.textarea);

    assert.deepEqual(fixture.style, {});
    assert.equal(fixture.pendingFrameCount, 1);

    fixture.runFrame();

    assert.deepEqual(fixture.style, {
      height: "180px",
      maxHeight: "210px",
    });
    assert.equal(fixture.pendingFrameCount, 0);
  });

  it("resets the old viewport before measuring deleted content", function () {
    const fixture = createTextareaFixture({
      hostHeight: 1_000,
      initialHeight: 420,
      scrollHeight: 34,
      scrollHeightIncludesViewport: true,
    });

    resizeTextarea(fixture.textarea);

    assert.equal(fixture.style.height, "34px");
    assert.deepEqual(fixture.measuredAtHeights, ["0px"]);
    assert.notProperty(fixture.style, "overflowY");
  });

  it("ignores a scheduled resize after the editor disconnects", function () {
    const fixture = createTextareaFixture({
      hostHeight: 500,
      scrollHeight: 120,
    });

    requestTextareaResize(fixture.textarea);
    fixture.isConnected = false;
    fixture.runFrame();

    assert.deepEqual(fixture.style, {});
  });
});

function createTextareaFixture({
  hostHeight,
  initialHeight,
  scrollHeight,
  scrollHeightIncludesViewport = false,
}: {
  hostHeight: number | null;
  initialHeight?: number;
  scrollHeight: number;
  scrollHeightIncludesViewport?: boolean;
}) {
  const style: Record<string, string> =
    initialHeight === undefined ? {} : { height: `${initialHeight}px` };
  const measuredAtHeights: string[] = [];
  let closestSelector = "";
  let connected = true;
  let currentScrollHeight = scrollHeight;
  let nextFrameId = 0;
  const frames = new Map<number, () => void>();
  const ownerWindow = {
    cancelAnimationFrame(frame: number) {
      frames.delete(frame);
    },
    requestAnimationFrame(callback: () => void) {
      const frame = ++nextFrameId;
      frames.set(frame, callback);
      return frame;
    },
  };
  const textarea = {
    closest(selector: string) {
      closestSelector = selector;
      return hostHeight === null ? null : { clientHeight: hostHeight };
    },
    get isConnected() {
      return connected;
    },
    ownerDocument: {
      defaultView: ownerWindow,
    },
    get scrollHeight() {
      measuredAtHeights.push(style.height || "");
      return scrollHeightIncludesViewport
        ? Math.max(currentScrollHeight, Number.parseFloat(style.height) || 0)
        : currentScrollHeight;
    },
    style,
  } as unknown as HTMLTextAreaElement;
  return {
    get closestSelector() {
      return closestSelector;
    },
    set isConnected(value: boolean) {
      connected = value;
    },
    get pendingFrameCount() {
      return frames.size;
    },
    measuredAtHeights,
    runFrame() {
      const entry = frames.entries().next().value as
        [number, () => void] | undefined;
      if (!entry) return;
      frames.delete(entry[0]);
      entry[1]();
    },
    set scrollHeight(value: number) {
      currentScrollHeight = value;
    },
    style,
    textarea,
  };
}
