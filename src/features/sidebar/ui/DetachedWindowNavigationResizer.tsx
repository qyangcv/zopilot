import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";
import { getString } from "../../../app/localization";
import { DETACHED_WINDOW_NAVIGATION_ID } from "./DetachedWindowNavigation";

const DETACHED_NAVIGATION_DEFAULT_WIDTH = 232;
const DETACHED_NAVIGATION_MIN_WIDTH = 176;
const DETACHED_NAVIGATION_MAX_WIDTH = 420;
const DETACHED_MAIN_MIN_WIDTH = 360;
const DETACHED_NAVIGATION_KEYBOARD_STEP = 16;
const DETACHED_NAVIGATION_WIDTH_PROPERTY =
  "--zp-detached-navigation-expanded-width";

type DragState = {
  direction: 1 | -1;
  pointerId: number;
  startClientX: number;
  startWidth: number;
};

export function DetachedWindowNavigationResizer({
  expanded,
  rootRef,
}: {
  expanded: boolean;
  rootRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const [width, setWidth] = useState(DETACHED_NAVIGATION_DEFAULT_WIDTH);
  const [maxWidth, setMaxWidth] = useState(DETACHED_NAVIGATION_MAX_WIDTH);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | undefined>(undefined);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty(DETACHED_NAVIGATION_WIDTH_PROPERTY, `${width}px`);
    return () => {
      root.style.removeProperty(DETACHED_NAVIGATION_WIDTH_PROPERTY);
    };
  }, [rootRef, width]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const win = root.ownerDocument?.defaultView;
    const updateBounds = () => {
      const rootWidth = root.getBoundingClientRect().width;
      const nextMax = resolveDetachedNavigationMaxWidth(rootWidth);
      setMaxWidth(nextMax);
      setWidth((current) => clampDetachedNavigationWidth(current, rootWidth));
    };
    updateBounds();
    const ResizeObserverCtor = win?.ResizeObserver || globalThis.ResizeObserver;
    const observer = ResizeObserverCtor
      ? new ResizeObserverCtor(updateBounds)
      : undefined;
    observer?.observe(root);
    win?.addEventListener("resize", updateBounds);
    return () => {
      observer?.disconnect();
      win?.removeEventListener("resize", updateBounds);
    };
  }, [rootRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (dragging) {
      root.dataset.navigationResizing = "true";
    } else {
      delete root.dataset.navigationResizing;
    }
    return () => {
      delete root.dataset.navigationResizing;
    };
  }, [dragging, rootRef]);

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    const rootWidth = root.getBoundingClientRect().width;
    const startWidth = readNavigationWidth(root, width);
    const direction = isRtl(root) ? -1 : 1;
    dragRef.current = {
      direction,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth,
    };
    setMaxWidth(resolveDetachedNavigationMaxWidth(rootWidth));
    setWidth(clampDetachedNavigationWidth(startWidth, rootWidth));
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !root) return;
    const delta = (event.clientX - drag.startClientX) * drag.direction;
    setWidth(
      clampDetachedNavigationWidth(
        drag.startWidth + delta,
        root.getBoundingClientRect().width,
      ),
    );
    event.preventDefault();
  };

  const finishResize = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root) return;
    const rootWidth = root.getBoundingClientRect().width;
    const nextMax = resolveDetachedNavigationMaxWidth(rootWidth);
    const rtl = isRtl(root);
    let nextWidth: number | undefined;
    if (event.key === "Home") {
      nextWidth = DETACHED_NAVIGATION_MIN_WIDTH;
    } else if (event.key === "End") {
      nextWidth = nextMax;
    } else if (event.key === "ArrowLeft") {
      nextWidth = width + (rtl ? 1 : -1) * DETACHED_NAVIGATION_KEYBOARD_STEP;
    } else if (event.key === "ArrowRight") {
      nextWidth = width + (rtl ? -1 : 1) * DETACHED_NAVIGATION_KEYBOARD_STEP;
    }
    if (nextWidth === undefined) return;
    event.preventDefault();
    setMaxWidth(nextMax);
    setWidth(clampDetachedNavigationWidth(nextWidth, rootWidth));
  };

  return (
    <div
      aria-label={getString("sidebar-resize-window-navigation")}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={DETACHED_NAVIGATION_MIN_WIDTH}
      aria-valuenow={width}
      className="zp-detached-navigation-resizer"
      data-dragging={dragging || undefined}
      hidden={!expanded}
      onKeyDown={resizeWithKeyboard}
      onLostPointerCapture={finishResize}
      onPointerCancel={finishResize}
      onPointerDown={beginResize}
      onPointerMove={continueResize}
      onPointerUp={finishResize}
      role="separator"
      tabIndex={expanded ? 0 : -1}
    />
  );
}

function readNavigationWidth(root: HTMLElement, fallback: number): number {
  const navigation = root.querySelector(`#${DETACHED_WINDOW_NAVIGATION_ID}`);
  const measured = navigation?.getBoundingClientRect().width;
  return typeof measured === "number" && Number.isFinite(measured)
    ? measured
    : fallback;
}

function isRtl(root: HTMLElement): boolean {
  const win = root.ownerDocument?.defaultView;
  return win?.getComputedStyle(root)?.direction === "rtl";
}

export function resolveDetachedNavigationMaxWidth(rootWidth: number): number {
  if (!Number.isFinite(rootWidth) || rootWidth <= 0) {
    return DETACHED_NAVIGATION_MAX_WIDTH;
  }
  return Math.max(
    DETACHED_NAVIGATION_MIN_WIDTH,
    Math.min(
      DETACHED_NAVIGATION_MAX_WIDTH,
      Math.floor(rootWidth - DETACHED_MAIN_MIN_WIDTH),
    ),
  );
}

export function clampDetachedNavigationWidth(
  width: number,
  rootWidth: number,
): number {
  const normalized = Number.isFinite(width)
    ? Math.round(width)
    : DETACHED_NAVIGATION_DEFAULT_WIDTH;
  return Math.min(
    resolveDetachedNavigationMaxWidth(rootWidth),
    Math.max(DETACHED_NAVIGATION_MIN_WIDTH, normalized),
  );
}

export {
  DETACHED_MAIN_MIN_WIDTH,
  DETACHED_NAVIGATION_DEFAULT_WIDTH,
  DETACHED_NAVIGATION_MAX_WIDTH,
  DETACHED_NAVIGATION_MIN_WIDTH,
};
