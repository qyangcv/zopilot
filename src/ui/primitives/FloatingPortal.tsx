import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  calculateFloatingPosition,
  type FloatingAlign,
  type FloatingSide,
} from "./floatingPosition";

export { FloatingPortal, ZopilotUIProvider };

type ZopilotUIContextValue = {
  portalRoot?: HTMLElement | null;
};

const ZopilotUIContext = createContext<ZopilotUIContextValue>({});

function ZopilotUIProvider({
  children,
  portalRoot,
}: {
  children: ReactNode;
  portalRoot?: HTMLElement | null;
}): ReactElement {
  return (
    <ZopilotUIContext.Provider value={{ portalRoot }}>
      {children}
    </ZopilotUIContext.Provider>
  );
}

function FloatingPortal({
  align = "start",
  anchorRef,
  children,
  maxHeight,
  maxWidth = 360,
  minWidth = 160,
  offset = 6,
  onDismiss,
  preferredSide = "above",
  renderInlineWithoutPortal = true,
  width,
  zIndex = 7,
}: {
  align?: FloatingAlign;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  maxHeight?: number;
  maxWidth?: number;
  minWidth?: number;
  offset?: number;
  onDismiss: () => void;
  preferredSide?: FloatingSide;
  renderInlineWithoutPortal?: boolean;
  width?: number;
  zIndex?: number;
}): ReactElement | null {
  const { portalRoot } = useZopilotUI();
  const [style, setStyle] = useState<CSSProperties>({
    visibility: "hidden",
    zIndex,
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!portalRoot || !anchor) return;
    const win = portalRoot.ownerDocument?.defaultView;
    const updatePosition = () => {
      const next = calculateFloatingPosition({
        align,
        anchorRect: anchor.getBoundingClientRect(),
        maxWidth,
        minWidth,
        offset,
        preferredSide,
        rootRect: portalRoot.getBoundingClientRect(),
        width,
      });
      const resolvedMaxHeight =
        maxHeight === undefined
          ? next.maxHeight
          : Math.min(next.maxHeight, maxHeight);
      setStyle({
        bottom:
          next.side === "above" && next.bottom !== undefined
            ? `${Math.round(next.bottom)}px`
            : undefined,
        left: `${Math.round(next.left)}px`,
        maxHeight: `${Math.floor(resolvedMaxHeight)}px`,
        top:
          next.side === "below" && next.top !== undefined
            ? `${Math.round(next.top)}px`
            : undefined,
        visibility: "visible",
        width: `${Math.round(next.width)}px`,
        zIndex,
      });
    };
    updatePosition();
    win?.addEventListener("resize", updatePosition);
    win?.addEventListener("scroll", updatePosition, true);
    return () => {
      win?.removeEventListener("resize", updatePosition);
      win?.removeEventListener("scroll", updatePosition, true);
    };
  }, [
    align,
    anchorRef,
    maxHeight,
    maxWidth,
    minWidth,
    offset,
    portalRoot,
    preferredSide,
    width,
    zIndex,
  ]);

  if (!portalRoot) {
    return renderInlineWithoutPortal ? <>{children}</> : null;
  }
  return createPortal(
    <div
      className="zp-dismiss-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="zp-floating-layer" style={style}>
        {children}
      </div>
    </div>,
    portalRoot,
  ) as ReactElement;
}

function useZopilotUI(): ZopilotUIContextValue {
  return useContext(ZopilotUIContext);
}
