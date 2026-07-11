export { calculateFloatingPosition, type FloatingAlign, type FloatingSide };

type FloatingAlign = "start" | "end" | "stretch";
type FloatingSide = "above" | "below";

type FloatingRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type FloatingPosition = {
  bottom?: number;
  left: number;
  maxHeight: number;
  side: FloatingSide;
  top?: number;
  width: number;
};

function calculateFloatingPosition({
  align = "start",
  anchorRect,
  margin = 8,
  maxWidth = 360,
  minHeight = 96,
  minWidth = 160,
  offset = 6,
  preferredSide = "above",
  rootRect,
  width,
}: {
  align?: FloatingAlign;
  anchorRect: FloatingRect;
  margin?: number;
  maxWidth?: number;
  minHeight?: number;
  minWidth?: number;
  offset?: number;
  preferredSide?: FloatingSide;
  rootRect: FloatingRect;
  width?: number;
}): FloatingPosition {
  const usableWidth = Math.max(1, rootRect.width - margin * 2);
  const widthLimit = Math.max(1, Math.min(maxWidth, usableWidth));
  const preferredWidth = width ?? anchorRect.width;
  const resolvedWidth = Math.max(
    1,
    Math.min(Math.max(preferredWidth, minWidth), widthLimit),
  );
  const anchorStart = anchorRect.left - rootRect.left;
  const anchorEnd = anchorRect.right - rootRect.left;
  const unclampedLeft =
    align === "end" ? anchorEnd - resolvedWidth : anchorStart;
  const left = clamp(
    unclampedLeft,
    margin,
    Math.max(margin, rootRect.width - margin - resolvedWidth),
  );
  const availableAbove = Math.max(
    1,
    anchorRect.top - rootRect.top - offset - margin,
  );
  const availableBelow = Math.max(
    1,
    rootRect.bottom - anchorRect.bottom - offset - margin,
  );
  const side =
    preferredSide === "above"
      ? availableAbove >= minHeight || availableAbove >= availableBelow
        ? "above"
        : "below"
      : availableBelow >= minHeight || availableBelow >= availableAbove
        ? "below"
        : "above";

  if (side === "above") {
    return {
      bottom: Math.max(margin, rootRect.bottom - anchorRect.top + offset),
      left,
      maxHeight: availableAbove,
      side,
      width: resolvedWidth,
    };
  }

  return {
    left,
    maxHeight: availableBelow,
    side,
    top: Math.max(margin, anchorRect.bottom - rootRect.top + offset),
    width: resolvedWidth,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
