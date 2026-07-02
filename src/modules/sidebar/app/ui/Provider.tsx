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

function Portal({ children }: { children: ReactNode }): ReactElement {
  const { portalRoot } = useZopilotUI();
  if (!portalRoot) {
    return <>{children}</>;
  }
  return createPortal(children, portalRoot) as ReactElement;
}

function FloatingPortal({
  align = "start",
  anchorRef,
  children,
  maxWidth = 360,
  minWidth = 160,
  offset = 6,
  onDismiss,
  preferredSide = "above",
  width,
  zIndex = 7,
}: {
  align?: FloatingAlign;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  maxWidth?: number;
  minWidth?: number;
  offset?: number;
  onDismiss: () => void;
  preferredSide?: FloatingSide;
  width?: number;
  zIndex?: number;
}): ReactElement {
  const { portalRoot } = useZopilotUI();
  const [style, setStyle] = useState<CSSProperties>({
    visibility: "hidden",
    zIndex,
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!portalRoot || !anchor) {
      return;
    }
    const ownerDocument = portalRoot.ownerDocument;
    if (!ownerDocument) {
      return;
    }
    const win = ownerDocument.defaultView;
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
      setStyle({
        bottom:
          next.side === "above" && next.bottom !== undefined
            ? `${Math.round(next.bottom)}px`
            : undefined,
        left: `${Math.round(next.left)}px`,
        maxHeight: `${Math.floor(next.maxHeight)}px`,
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
    maxWidth,
    minWidth,
    offset,
    portalRoot,
    preferredSide,
    width,
    zIndex,
  ]);

  return (
    <Portal>
      <DismissLayer onDismiss={onDismiss}>
        <div className="zp-floating-layer" style={style}>
          {children}
        </div>
      </DismissLayer>
    </Portal>
  );
}

function DismissLayer({
  children,
  onDismiss,
}: {
  children: ReactNode;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div
      className="zp-dismiss-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
    >
      {children}
    </div>
  );
}

function useZopilotUI(): ZopilotUIContextValue {
  return useContext(ZopilotUIContext);
}
