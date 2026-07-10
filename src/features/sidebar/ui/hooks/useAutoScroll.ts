import { useLayoutEffect, useRef } from "react";

function useAutoScroll(dependency: unknown): {
  logRef: React.RefObject<HTMLElement | null>;
  onScroll: (element: HTMLElement) => void;
} {
  const logRef = useRef<HTMLElement | null>(null);
  const autoScrollRef = useRef(true);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && autoScrollRef.current) {
      log.scrollTop = log.scrollHeight;
    }
  }, [dependency]);

  return {
    logRef,
    onScroll: (element) => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      autoScrollRef.current = distanceFromBottom <= 32;
    },
  };
}

export { useAutoScroll };
