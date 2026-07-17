import { useCallback, useLayoutEffect, useRef } from "react";
import { beginSidebarPerformanceMeasure } from "../performanceMetrics";

function useAutoScroll(
  resetKey: unknown,
  dependency: unknown,
): {
  logRef: React.RefObject<HTMLElement | null>;
  onScroll: (element: HTMLElement) => void;
  sync: () => void;
} {
  const logRef = useRef<HTMLElement | null>(null);
  const followingRef = useRef(true);

  const sync = useCallback(() => {
    const log = logRef.current;
    if (log && followingRef.current) {
      const finish = beginSidebarPerformanceMeasure("scroll.sync");
      try {
        log.scrollTop = log.scrollHeight;
      } finally {
        finish?.();
      }
    }
  }, []);

  useLayoutEffect(() => {
    followingRef.current = true;
    sync();
  }, [resetKey, sync]);

  useLayoutEffect(() => {
    sync();
  }, [dependency, sync]);

  return {
    logRef,
    sync,
    onScroll: (element) => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      followingRef.current = distanceFromBottom <= 32;
    },
  };
}

export { useAutoScroll };
