import {
  forwardRef,
  useEffect,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

export {
  PopupHeader,
  PopupList,
  PopupRow,
  PopupSurface,
  constrainPopupActiveIndex,
  findPopupEdgeIndex,
  findPopupNextIndex,
  usePopupListNavigation,
};
export type { PopupFocusMode };

type PopupFocusMode = "external" | "popup";

type PopupSurfaceProps = HTMLAttributes<HTMLDivElement>;

const PopupSurface = forwardRef<HTMLDivElement, PopupSurfaceProps>(
  function PopupSurface({ className, ...props }, ref): ReactElement {
    return (
      <div
        {...props}
        className={["zp-popup-surface", className].filter(Boolean).join(" ")}
        ref={ref}
      />
    );
  },
);

const PopupHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    actions?: ReactNode;
    title: ReactNode;
  }
>(function PopupHeader(
  { actions, className, title, ...props },
  ref,
): ReactElement {
  return (
    <div
      {...props}
      className={["zp-popup-header", className].filter(Boolean).join(" ")}
      ref={ref}
    >
      <span className="zp-popup-header-title">{title}</span>
      {actions ? (
        <span className="zp-popup-header-actions">{actions}</span>
      ) : null}
    </div>
  );
});

const PopupList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function PopupList({ className, ...props }, ref): ReactElement {
    return (
      <div
        {...props}
        className={["zp-popup-list", className].filter(Boolean).join(" ")}
        ref={ref}
      />
    );
  },
);

type PopupRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  action?: ReactNode;
  active?: boolean;
  description?: ReactNode;
  disabled?: boolean;
  disclosure?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  metadata?: ReactNode;
  selected?: boolean;
  selection?: ReactNode;
  title?: string;
};

const PopupRow = forwardRef<HTMLDivElement, PopupRowProps>(function PopupRow(
  {
    action,
    active,
    className,
    description,
    disabled,
    disclosure,
    icon,
    label,
    metadata,
    selected,
    selection,
    ...props
  },
  ref,
): ReactElement {
  return (
    <div
      {...props}
      aria-disabled={disabled || undefined}
      className={["zp-popup-row", className].filter(Boolean).join(" ")}
      data-active={active || undefined}
      data-disabled={disabled || undefined}
      data-selected={selected || undefined}
      ref={ref}
    >
      {selection !== undefined ? (
        <span className="zp-popup-row-selection">{selection}</span>
      ) : null}
      {disclosure !== undefined ? (
        <span className="zp-popup-row-disclosure">{disclosure}</span>
      ) : null}
      {icon !== undefined ? (
        <span className="zp-popup-row-icon">{icon}</span>
      ) : null}
      <span className="zp-popup-row-label">{label}</span>
      {description !== undefined ? (
        <>
          <span aria-hidden="true" className="zp-popup-row-separator">
            ·
          </span>
          <span className="zp-popup-row-description">{description}</span>
        </>
      ) : null}
      {metadata !== undefined ? (
        <span className="zp-popup-row-metadata">{metadata}</span>
      ) : null}
      {action !== undefined ? (
        <span className="zp-popup-row-action">{action}</span>
      ) : null}
    </div>
  );
});

function findPopupEdgeIndex(
  itemCount: number,
  isDisabled: (index: number) => boolean,
  edge: "first" | "last",
): number {
  if (edge === "first") {
    for (let index = 0; index < itemCount; index += 1) {
      if (!isDisabled(index)) return index;
    }
    return -1;
  }
  for (let index = itemCount - 1; index >= 0; index -= 1) {
    if (!isDisabled(index)) return index;
  }
  return -1;
}

function findPopupNextIndex(
  itemCount: number,
  activeIndex: number,
  direction: 1 | -1,
  isDisabled: (index: number) => boolean,
  loop = true,
): number {
  if (!itemCount) return -1;
  const fallback = findPopupEdgeIndex(
    itemCount,
    isDisabled,
    direction === 1 ? "first" : "last",
  );
  if (activeIndex < 0 || activeIndex >= itemCount) return fallback;
  for (let step = 1; step <= itemCount; step += 1) {
    const rawIndex = activeIndex + step * direction;
    if (!loop && (rawIndex < 0 || rawIndex >= itemCount)) return activeIndex;
    const index = (rawIndex + itemCount) % itemCount;
    if (!isDisabled(index)) return index;
  }
  return activeIndex;
}

function constrainPopupActiveIndex(
  itemCount: number,
  activeIndex: number,
  isDisabled: (index: number) => boolean,
): number {
  if (!itemCount) return -1;
  if (activeIndex >= 0 && activeIndex < itemCount && !isDisabled(activeIndex)) {
    return activeIndex;
  }
  const start = Math.min(Math.max(activeIndex, 0), itemCount - 1);
  for (let distance = 0; distance < itemCount; distance += 1) {
    const after = start + distance;
    if (after < itemCount && !isDisabled(after)) return after;
    const before = start - distance;
    if (before >= 0 && !isDisabled(before)) return before;
  }
  return -1;
}

function usePopupListNavigation({
  activeIndex,
  autoFocus = true,
  enabled = true,
  focusMode = "popup",
  isDisabled = () => false,
  itemCount,
  itemRefs,
  listRef,
  loop = true,
  onActiveIndexChange,
  onCollapse,
  onCommit,
  onDismiss,
  onExpand,
  restoreFocusRef,
}: {
  activeIndex: number;
  autoFocus?: boolean;
  enabled?: boolean;
  focusMode?: PopupFocusMode;
  isDisabled?: (index: number) => boolean;
  itemCount: number;
  itemRefs?: RefObject<Array<HTMLElement | null>>;
  listRef?: RefObject<HTMLElement | null>;
  loop?: boolean;
  onActiveIndexChange: (index: number) => void;
  onCollapse?: (index: number) => void;
  onCommit: (index: number) => void;
  onDismiss: () => void;
  onExpand?: (index: number) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}): {
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
} {
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      focusedRef.current = false;
      return;
    }
    const constrained = constrainPopupActiveIndex(
      itemCount,
      activeIndex,
      isDisabled,
    );
    if (constrained !== activeIndex) onActiveIndexChange(constrained);
  }, [activeIndex, enabled, isDisabled, itemCount, onActiveIndexChange]);

  useEffect(() => {
    if (!enabled) return;
    if (
      focusMode === "popup" &&
      autoFocus &&
      !focusedRef.current &&
      listRef?.current
    ) {
      focusedRef.current = true;
      listRef.current.focus({ preventScroll: true });
    }
    if (activeIndex < 0) return;
    const option = itemRefs?.current[activeIndex];
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, autoFocus, enabled, focusMode, itemRefs, listRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!enabled) return false;
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      nextIndex = findPopupNextIndex(
        itemCount,
        activeIndex,
        event.key === "ArrowDown" ? 1 : -1,
        isDisabled,
        loop,
      );
    } else if (event.key === "Home" || event.key === "End") {
      nextIndex = findPopupEdgeIndex(
        itemCount,
        isDisabled,
        event.key === "Home" ? "first" : "last",
      );
    } else if (event.key === "Enter") {
      const actionTarget = (event.target as HTMLElement | null)?.closest?.(
        "[data-popup-action]",
      );
      if (actionTarget) return false;
      if (activeIndex >= 0 && !isDisabled(activeIndex)) onCommit(activeIndex);
    } else if (event.key === "Escape") {
      onDismiss();
      if (restoreFocusRef) {
        queueMicrotask(() =>
          restoreFocusRef.current?.focus({ preventScroll: true }),
        );
      }
    } else if (event.key === "ArrowLeft" && onCollapse) {
      onCollapse(activeIndex);
    } else if (event.key === "ArrowRight" && onExpand) {
      onExpand(activeIndex);
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (nextIndex !== undefined && nextIndex >= 0) {
      onActiveIndexChange(nextIndex);
    }
    return true;
  };

  return { onKeyDown };
}
