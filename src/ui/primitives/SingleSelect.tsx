import { ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { FloatingPortal } from "./FloatingPortal";

export { SingleSelect };
export type { SingleSelectOption, SingleSelectSubOption };

type SingleSelectVariant = "compact" | "form";

type SingleSelectSubOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

type SingleSelectOption = {
  disabled?: boolean;
  groupIcon?: ReactNode;
  groupLabel?: string;
  icon?: ReactNode;
  label: string;
  subDefaultValue?: string;
  subOptions?: SingleSelectSubOption[];
  subValue?: string;
  triggerIcon?: ReactNode;
  triggerDetail?: string;
  value: string;
};

function SingleSelect({
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  allowFullTriggerLabel = false,
  disabled,
  onChange,
  onSubChange,
  options,
  popupMinWidth,
  popupWidth,
  preferredSide,
  showIndicator = true,
  subPopupLabel,
  subPopupMinWidth = 96,
  title,
  value,
  variant = "form",
}: {
  "aria-label"?: string;
  "aria-labelledby"?: string;
  allowFullTriggerLabel?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubChange?: (value: string, subValue: string) => void;
  options: SingleSelectOption[];
  popupMinWidth?: number;
  popupWidth?: number;
  preferredSide?: "above" | "below";
  showIndicator?: boolean;
  subPopupLabel?: string;
  subPopupMinWidth?: number;
  title?: string;
  value: string;
  variant?: SingleSelectVariant;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [submenuParentIndex, setSubmenuParentIndex] = useState(-1);
  const [subActiveIndex, setSubActiveIndex] = useState(-1);
  const [submenuStyle, setSubmenuStyle] = useState<CSSProperties>();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subListboxRef = useRef<HTMLDivElement | null>(null);
  const subOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusSubmenuRef = useRef(false);
  const listboxId = `zp-single-select-${useId().replaceAll(":", "")}`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const submenuOption = options[submenuParentIndex];
  const subOptions = submenuOption?.subOptions || [];
  const submenuOpen = open && submenuParentIndex >= 0 && subOptions.length > 0;
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

  useEffect(() => {
    if (!submenuOpen) return;
    const option = subOptionRefs.current[subActiveIndex];
    if (
      option &&
      (focusSubmenuRef.current ||
        subListboxRef.current?.contains(
          option.ownerDocument?.activeElement || null,
        ))
    ) {
      focusSubmenuRef.current = false;
      option.focus({ preventScroll: true });
    }
  }, [subActiveIndex, submenuOpen]);

  useLayoutEffect(() => {
    if (!submenuOpen) return;
    const listbox = listboxRef.current;
    const option = optionRefs.current[submenuParentIndex];
    if (!listbox || !option) return;
    setSubmenuStyle(
      calculateSubmenuStyle(
        listbox.getBoundingClientRect(),
        option.getBoundingClientRect(),
        listbox.closest(".zp-dismiss-layer")?.getBoundingClientRect(),
        subListboxRef.current?.offsetHeight || 0,
        subPopupMinWidth,
      ),
    );
  }, [submenuOpen, submenuParentIndex, subPopupMinWidth]);

  const openSelect = (initialIndex?: number) => {
    if (disabled || !options.length) return;
    const fallback =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : findFirstEnabledIndex(options);
    setActiveIndex(initialIndex ?? fallback);
    setSubmenuParentIndex(-1);
    setOpen(true);
  };
  const closeSelect = (restoreFocus = true) => {
    setOpen(false);
    setSubmenuParentIndex(-1);
    focusSubmenuRef.current = false;
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
    }
  };
  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.subOptions?.length && onSubChange) {
      const defaultSubOption = findDefaultSubOption(option);
      if (defaultSubOption) {
        onSubChange(option.value, defaultSubOption.value);
        closeSelect();
        return;
      }
      openSubmenu(index);
      return;
    }
    if (option.value !== value) onChange(option.value);
    closeSelect();
  };
  const openSubmenu = (index: number, focus = false) => {
    const option = options[index];
    if (!option?.subOptions?.length || !onSubChange) {
      setSubmenuParentIndex(-1);
      return;
    }
    const nextSubIndex = findResolvedSubOptionIndex(option);
    setSubmenuParentIndex(index);
    setSubActiveIndex(nextSubIndex);
    if (focus) {
      focusSubmenuRef.current = true;
    }
  };
  const selectSubIndex = (index: number) => {
    const subOption = subOptions[index];
    if (!submenuOption || !subOption || subOption.disabled || !onSubChange) {
      return;
    }
    onSubChange(submenuOption.value, subOption.value);
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
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      openSubmenu(activeIndex, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSelect();
    } else if (event.key === "Tab") {
      closeSelect(false);
    }
  };
  const handleSubListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSubActiveIndex((current) =>
        findNextEnabledIndex(
          subOptions,
          current,
          event.key === "ArrowDown" ? 1 : -1,
        ),
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setSubActiveIndex(
        event.key === "Home"
          ? findFirstEnabledIndex(subOptions)
          : findLastEnabledIndex(subOptions),
      );
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectSubIndex(subActiveIndex);
    } else if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      setSubmenuParentIndex(-1);
      listboxRef.current?.focus({ preventScroll: true });
    } else if (event.key === "Tab") {
      closeSelect(false);
    }
  };

  return (
    <span
      className="zp-single-select"
      data-full-trigger-label={allowFullTriggerLabel || undefined}
      data-variant={variant}
    >
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
          {selected?.triggerDetail ? (
            <span className="zp-single-select-trigger-value">
              <span className="zp-single-select-trigger-primary">
                {selected.label}
              </span>
              <span
                aria-hidden="true"
                className="zp-single-select-trigger-separator"
              >
                ·
              </span>
              <span className="zp-single-select-trigger-detail">
                {selected.triggerDetail}
              </span>
            </span>
          ) : (
            <span>{selected?.label || value || title}</span>
          )}
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
            popupWidth ??
            (variant === "form" ? triggerRef.current?.offsetWidth : undefined)
          }
          zIndex={variant === "compact" ? 7 : 1000}
        >
          <div
            className="zp-single-select-cascade"
            data-submenu-open={submenuOpen || undefined}
            onMouseLeave={() => setSubmenuParentIndex(-1)}
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
              onScroll={() => {
                if (submenuOpen) setSubmenuParentIndex(-1);
              }}
              ref={listboxRef}
              role="listbox"
              tabIndex={0}
            >
              {options.map((option, index) => (
                <span
                  className="zp-single-select-option-wrap"
                  key={option.value}
                >
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
                    aria-expanded={
                      option.subOptions?.length
                        ? submenuParentIndex === index
                        : undefined
                    }
                    aria-haspopup={
                      option.subOptions?.length ? "listbox" : undefined
                    }
                    aria-selected={option.value === value}
                    className="zp-single-select-option"
                    data-active={index === activeIndex || undefined}
                    data-group-child={option.groupLabel ? true : undefined}
                    data-selected={option.value === value || undefined}
                    disabled={option.disabled}
                    id={`${listboxId}-option-${index}`}
                    onClick={() => selectIndex(index)}
                    onMouseEnter={() => {
                      if (!option.disabled) {
                        setActiveIndex(index);
                        openSubmenu(index);
                      }
                    }}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    role="option"
                    tabIndex={-1}
                    title={option.subOptions?.length ? undefined : option.label}
                    type="button"
                  >
                    {option.icon}
                    <span className="zp-single-select-option-label">
                      {option.label}
                    </span>
                  </button>
                </span>
              ))}
            </div>
            {submenuOpen ? (
              <div
                aria-activedescendant={
                  subActiveIndex >= 0
                    ? `${listboxId}-suboption-${subActiveIndex}`
                    : undefined
                }
                aria-label={subPopupLabel}
                className="zp-single-select-popup zp-single-select-submenu"
                data-variant={variant}
                onKeyDown={handleSubListboxKeyDown}
                ref={subListboxRef}
                role="listbox"
                style={{ ...submenuStyle, width: subPopupMinWidth }}
                tabIndex={0}
              >
                {subOptions.map((subOption, index) => (
                  <button
                    aria-disabled={subOption.disabled || undefined}
                    aria-selected={subOption.value === submenuOption?.subValue}
                    className="zp-single-select-option"
                    data-active={index === subActiveIndex || undefined}
                    data-selected={
                      subOption.value === submenuOption?.subValue || undefined
                    }
                    disabled={subOption.disabled}
                    id={`${listboxId}-suboption-${index}`}
                    key={subOption.value}
                    onClick={() => selectSubIndex(index)}
                    onMouseEnter={() => {
                      if (!subOption.disabled) setSubActiveIndex(index);
                    }}
                    ref={(element) => {
                      subOptionRefs.current[index] = element;
                    }}
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="zp-single-select-option-label">
                      {subOption.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  );
}

function findDefaultSubOption(
  option: SingleSelectOption,
): SingleSelectSubOption | undefined {
  if (!option.subOptions?.length) return undefined;
  return (
    option.subOptions.find(
      (subOption) =>
        subOption.value === option.subDefaultValue && !subOption.disabled,
    ) || option.subOptions.find((subOption) => !subOption.disabled)
  );
}

function findResolvedSubOptionIndex(option: SingleSelectOption): number {
  if (!option.subOptions?.length) return -1;
  const selectedIndex = option.subOptions.findIndex(
    (subOption) => subOption.value === option.subValue && !subOption.disabled,
  );
  if (selectedIndex >= 0) return selectedIndex;
  const defaultSubOption = findDefaultSubOption(option);
  return defaultSubOption ? option.subOptions.indexOf(defaultSubOption) : -1;
}

function calculateSubmenuStyle(
  listboxRect: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  optionRect: Pick<DOMRect, "bottom" | "top">,
  rootRect: Pick<DOMRect, "left" | "right"> | undefined,
  submenuHeight: number,
  submenuWidth: number,
): CSSProperties {
  const availableRight = rootRect ? rootRect.right - listboxRect.right : 0;
  const availableLeft = rootRect ? listboxRect.left - rootRect.left : 0;
  const openAtEnd =
    availableRight >= submenuWidth || availableRight >= availableLeft;
  const optionCenter = (optionRect.top + optionRect.bottom) / 2;
  const desiredTop = optionCenter - listboxRect.top - submenuHeight / 2;
  const maxTop = Math.max(
    0,
    listboxRect.bottom - listboxRect.top - submenuHeight,
  );
  return {
    insetInlineEnd: openAtEnd ? undefined : "100%",
    insetInlineStart: openAtEnd ? "100%" : undefined,
    top: Math.max(0, Math.min(desiredTop, maxTop)),
  };
}

function findFirstEnabledIndex(options: Array<{ disabled?: boolean }>): number {
  return options.findIndex((option) => !option.disabled);
}

function findLastEnabledIndex(options: Array<{ disabled?: boolean }>): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function findNextEnabledIndex(
  options: Array<{ disabled?: boolean }>,
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
  calculateSubmenuStyle,
  findDefaultSubOption,
  findFirstEnabledIndex,
  findLastEnabledIndex,
  findNextEnabledIndex,
  findResolvedSubOptionIndex,
  keepOptionVisible,
};
