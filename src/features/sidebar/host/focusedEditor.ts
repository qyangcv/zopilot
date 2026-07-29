type BlurrableElement = Element & {
  blur?: () => void;
};

function blurFocusedDescendant(
  ...roots: Array<Element | null | undefined>
): boolean {
  for (const root of roots) {
    if (!root) continue;
    const activeElement = root.ownerDocument
      ?.activeElement as BlurrableElement | null;
    if (!activeElement || !root.contains(activeElement)) continue;
    activeElement.blur?.();
    return true;
  }
  return false;
}

export { blurFocusedDescendant };
