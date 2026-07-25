import { useLayoutEffect, type RefObject } from "react";

function useSidebarLayoutBounds(
  headerRef: RefObject<HTMLElement | null>,
  bottomDockRef: RefObject<HTMLDivElement | null>,
): void {
  useLayoutEffect(() => {
    const bottomDock = bottomDockRef.current;
    const header = headerRef.current;
    const root = bottomDock?.closest(".zp-sidebar") as HTMLElement | null;
    if (!root || !bottomDock) {
      return;
    }
    const updateLayoutBounds = () => {
      root.style.setProperty(
        "--zp-header-height",
        header
          ? `${Math.ceil(header.getBoundingClientRect().height)}px`
          : "0px",
      );
      root.style.setProperty(
        "--zp-composer-height",
        `${Math.ceil(bottomDock.getBoundingClientRect().height)}px`,
      );
    };
    updateLayoutBounds();
    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (!ResizeObserverCtor) {
      return;
    }
    const resizeObserver = new ResizeObserverCtor(updateLayoutBounds);
    if (header) resizeObserver.observe(header);
    resizeObserver.observe(bottomDock);
    return () => resizeObserver.disconnect();
  }, [bottomDockRef, headerRef]);
}

export { useSidebarLayoutBounds };
