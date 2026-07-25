import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useZopilotPortalRoot } from "../../../ui/primitives/index";

const TOOLTIP_DELAY_MS = 450;
const TOOLTIP_GAP = 7;
const TOOLTIP_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 280;
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="treeitem"]',
].join(",");

type TooltipState = {
  anchor: HTMLElement;
  label: string;
};

export function DetachedWindowTooltipLayer({
  rootRef,
}: {
  rootRef: RefObject<HTMLElement | null>;
}): ReactElement | null {
  const portalRoot = useZopilotPortalRoot();
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const activeAnchorRef = useRef<HTMLElement | null>(null);
  const focusedAnchorRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const suppressedTitlesRef = useRef(new WeakMap<HTMLElement, string>());
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [style, setStyle] = useState<CSSProperties>({
    visibility: "hidden",
  });

  useEffect(() => {
    const root = rootRef.current;
    const doc = root?.ownerDocument;
    const win = doc?.defaultView;
    if (!root || !doc || !win) return;

    const clearTimer = () => {
      if (timerRef.current !== undefined) {
        win.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
    const restoreTitle = (anchor: HTMLElement | null) => {
      if (!anchor) return;
      const title = suppressedTitlesRef.current.get(anchor);
      if (title === undefined) return;
      anchor.setAttribute("title", title);
      suppressedTitlesRef.current.delete(anchor);
    };
    const hide = () => {
      clearTimer();
      restoreTitle(activeAnchorRef.current);
      activeAnchorRef.current = null;
      setTooltip(null);
      setStyle({ visibility: "hidden" });
    };
    const resolveTarget = (target: EventTarget | null) => {
      const element =
        target && (target as Node).nodeType === Node.ELEMENT_NODE
          ? (target as Element)
          : (target as Node | null)?.parentElement;
      const candidate = element?.closest(
        INTERACTIVE_SELECTOR,
      ) as HTMLElement | null;
      if (!candidate) return null;
      const insideWindow =
        root.contains(candidate) ||
        Boolean(candidate.closest(".zp-portal-root"));
      if (!insideWindow) return null;
      const label = (
        candidate.dataset.zpTooltip ||
        candidate.getAttribute("title") ||
        candidate.getAttribute("aria-label") ||
        ""
      ).trim();
      return label ? { anchor: candidate, label } : null;
    };
    const show = (
      next: NonNullable<ReturnType<typeof resolveTarget>>,
      immediate: boolean,
    ) => {
      if (activeAnchorRef.current === next.anchor && !immediate) return;
      if (activeAnchorRef.current !== next.anchor) {
        restoreTitle(activeAnchorRef.current);
        activeAnchorRef.current = next.anchor;
        const nativeTitle = next.anchor.getAttribute("title");
        if (nativeTitle !== null) {
          suppressedTitlesRef.current.set(next.anchor, nativeTitle);
          next.anchor.removeAttribute("title");
        }
      }
      clearTimer();
      const commit = () => {
        if (activeAnchorRef.current === next.anchor) {
          setTooltip(next);
        }
      };
      if (immediate) commit();
      else timerRef.current = win.setTimeout(commit, TOOLTIP_DELAY_MS);
    };
    const handleMouseOver = (event: MouseEvent) => {
      const next = resolveTarget(event.target);
      if (next) show(next, false);
    };
    const handleMouseOut = (event: MouseEvent) => {
      const active = activeAnchorRef.current;
      if (!active || active.contains(event.relatedTarget as Node | null)) {
        return;
      }
      if (focusedAnchorRef.current === active) return;
      hide();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const next = resolveTarget(event.target);
      focusedAnchorRef.current = next?.anchor || null;
      if (next) show(next, true);
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (
        focusedAnchorRef.current?.contains(event.relatedTarget as Node | null)
      ) {
        return;
      }
      focusedAnchorRef.current = null;
      hide();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };

    doc.addEventListener("mouseover", handleMouseOver, true);
    doc.addEventListener("mouseout", handleMouseOut, true);
    doc.addEventListener("focusin", handleFocusIn, true);
    doc.addEventListener("focusout", handleFocusOut, true);
    doc.addEventListener("keydown", handleKeyDown, true);
    doc.addEventListener("mousedown", hide, true);
    doc.addEventListener("scroll", hide, true);
    win.addEventListener("resize", hide);
    return () => {
      clearTimer();
      restoreTitle(activeAnchorRef.current);
      doc.removeEventListener("mouseover", handleMouseOver, true);
      doc.removeEventListener("mouseout", handleMouseOut, true);
      doc.removeEventListener("focusin", handleFocusIn, true);
      doc.removeEventListener("focusout", handleFocusOut, true);
      doc.removeEventListener("keydown", handleKeyDown, true);
      doc.removeEventListener("mousedown", hide, true);
      doc.removeEventListener("scroll", hide, true);
      win.removeEventListener("resize", hide);
    };
  }, [rootRef]);

  useLayoutEffect(() => {
    const layer = tooltipRef.current;
    if (!tooltip || !layer || !portalRoot) return;
    const rootRect = portalRoot.getBoundingClientRect();
    const anchorRect = tooltip.anchor.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const width = Math.min(TOOLTIP_MAX_WIDTH, Math.ceil(layerRect.width));
    const left = clamp(
      anchorRect.left - rootRect.left + (anchorRect.width - width) / 2,
      TOOLTIP_MARGIN,
      Math.max(TOOLTIP_MARGIN, rootRect.width - width - TOOLTIP_MARGIN),
    );
    const above =
      anchorRect.top - rootRect.top - layerRect.height - TOOLTIP_GAP;
    const top =
      above >= TOOLTIP_MARGIN
        ? above
        : Math.min(
            rootRect.height - layerRect.height - TOOLTIP_MARGIN,
            anchorRect.bottom - rootRect.top + TOOLTIP_GAP,
          );
    setStyle({
      left: `${Math.round(left)}px`,
      maxWidth: `${TOOLTIP_MAX_WIDTH}px`,
      top: `${Math.round(Math.max(TOOLTIP_MARGIN, top))}px`,
      visibility: "visible",
    });
  }, [portalRoot, tooltip]);

  if (!portalRoot || !tooltip) return null;
  return createPortal(
    <div
      className="zp-window-tooltip"
      ref={tooltipRef}
      role="tooltip"
      style={style}
    >
      {tooltip.label}
    </div>,
    portalRoot,
  ) as ReactElement;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
