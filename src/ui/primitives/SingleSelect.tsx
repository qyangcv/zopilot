import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { FloatingPortal } from "./FloatingPortal";

export { SingleSelect };
export type { SingleSelectOption };

type SingleSelectVariant = "compact" | "form";

type SingleSelectOption = {
  disabled?: boolean;
  groupIcon?: ReactNode;
  groupLabel?: string;
  icon?: ReactNode;
  label: string;
  triggerIcon?: ReactNode;
  value: string;
};

function SingleSelect({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  disabled,
  onChange,
  options,
  popupMinWidth,
  preferredSide,
  showIndicator = true,
  title,
  value,
  variant = "form",
}: {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SingleSelectOption[];
  popupMinWidth?: number;
  preferredSide?: "above" | "below";
  showIndicator?: boolean;
  title?: string;
  value: string;
  variant?: SingleSelectVariant;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `zp-single-select-${useId().replaceAll(":", "")}`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const resolvedPreferredSide =
    preferredSide || (variant === "compact" ? "above" : "below");
  const resolvedPopupMinWidth =
    popupMinWidth || (variant === "compact" ? 160 : 220);

  useEffect(() => {
    if (!open) return;
    const listbox = listboxRef.current;
    const option = optionRefs.current[activeIndex];
    listbox?.focus({ preventScroll: true });
    if (listbox && option) keepOptionVisible(listbox, option);
  }, [activeIndex, open]);

  const openSelect = (initialIndex?: number) => {
    if (disabled || !options.length) return;
    const fallback =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : findFirstEnabledIndex(options);
    setActiveIndex(initialIndex ?? fallback);
    setOpen(true);
  };
  const closeSelect = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };
  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    closeSelect();
  };
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openSelect(
        event.key === "ArrowDown"
          ? findFirstEnabledIndex(options)
          : findLastEnabledIndex(options),
      );
    }
  };
  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        findNextEnabledIndex(
          options,
          current,
          event.key === "ArrowDown" ? 1 : -1,
        ),
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(
        event.key === "Home"
          ? findFirstEnabledIndex(options)
          : findLastEnabledIndex(options),
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectIndex(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSelect();
    } else if (event.key === "Tab") {
      closeSelect(false);
    }
  };

  return (
    <span className="zp-single-select" data-variant={variant}>
      <button
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className="zp-single-select-trigger"
        data-popup-open={open || undefined}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          if (open) closeSelect();
          else openSelect();
        }}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        title={title}
        type="button"
      >
        <span className="zp-single-select-label">
          {selected?.triggerIcon ?? selected?.icon}
          <span>{selected?.label || value || title}</span>
        </span>
        {showIndicator ? (
          <ChevronDown
            aria-hidden="true"
            className="zp-single-select-indicator"
            size={variant === "compact" ? 11 : 16}
          />
        ) : null}
      </button>
      {open ? (
        <FloatingPortal
          anchorRef={triggerRef}
          maxWidth={variant === "compact" ? 280 : 520}
          minWidth={resolvedPopupMinWidth}
          onDismiss={() => closeSelect(false)}
          preferredSide={resolvedPreferredSide}
          width={
            variant === "form" ? triggerRef.current?.offsetWidth : undefined
          }
          zIndex={variant === "compact" ? 7 : 1000}
        >
          <div
            aria-activedescendant={
              activeIndex >= 0
                ? `${listboxId}-option-${activeIndex}`
                : undefined
            }
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            className="zp-single-select-popup"
            data-variant={variant}
            id={listboxId}
            onKeyDown={handleListboxKeyDown}
            ref={listboxRef}
            role="listbox"
            tabIndex={0}
          >
            {options.map((option, index) => (
              <span className="zp-single-select-option-wrap" key={option.value}>
                {option.groupLabel &&
                option.groupLabel !== options[index - 1]?.groupLabel ? (
                  <span className="zp-single-select-group">
                    <span className="zp-single-select-group-icon">
                      {option.groupIcon}
                    </span>
                    <span>{option.groupLabel}</span>
                  </span>
                ) : null}
                <button
                  aria-disabled={option.disabled || undefined}
                  aria-selected={option.value === value}
                  className="zp-single-select-option"
                  data-active={index === activeIndex || undefined}
                  data-group-child={option.groupLabel ? true : undefined}
                  data-selected={option.value === value || undefined}
                  disabled={option.disabled}
                  id={`${listboxId}-option-${index}`}
                  onClick={() => selectIndex(index)}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  tabIndex={-1}
                  title={option.label}
                  type="button"
                >
                  {option.icon}
                  <span>{option.label}</span>
                </button>
              </span>
            ))}
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  );
}

function findFirstEnabledIndex(options: SingleSelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function findLastEnabledIndex(options: SingleSelectOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function findNextEnabledIndex(
  options: SingleSelectOption[],
  current: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index =
      (current + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function keepOptionVisible(listbox: HTMLElement, option: HTMLElement): void {
  const listboxRect = listbox.getBoundingClientRect();
  const optionRect = option.getBoundingClientRect();
  if (optionRect.top < listboxRect.top) {
    listbox.scrollTop -= listboxRect.top - optionRect.top;
  } else if (optionRect.bottom > listboxRect.bottom) {
    listbox.scrollTop += optionRect.bottom - listboxRect.bottom;
  }
}

export {
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  keepOptionVisible,
};
