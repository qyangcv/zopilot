import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export { DismissLayer, Portal, ZopilotUIProvider, useZopilotUI };

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
