import { useRef, useState, type ReactElement } from "react";
import { Icon } from "../Icon";
import { FloatingPortal } from "./Provider";

export { Select };

type SelectOption = {
  label: string;
  value: string;
};

function Select({
  "aria-label": ariaLabel,
  disabled,
  onChange,
  options,
  showIndicator = true,
  title,
  value,
}: {
  "aria-label": string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
  showIndicator?: boolean;
  title: string;
  value: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.value === value);

  return (
    <span className="zp-ui-select">
      <button
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="zp-composer-select"
        data-indicator-hidden={!showIndicator || undefined}
        data-popup-open={open || undefined}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        ref={triggerRef}
        title={title}
        type="button"
      >
        <span className="zp-ui-select-label">
          {selected?.label || value || title}
        </span>
        {showIndicator ? (
          <Icon className="zp-ui-select-icon" name="expand" size={11} />
        ) : null}
      </button>
      {open ? (
        <FloatingPortal
          align="end"
          anchorRef={triggerRef}
          maxWidth={280}
          minWidth={160}
          onDismiss={() => setOpen(false)}
          preferredSide="above"
          zIndex={7}
        >
          <div
            aria-label={ariaLabel}
            className="zp-ui-select-popup"
            role="listbox"
          >
            {options.map((option) => (
              <button
                aria-selected={option.value === value}
                className="zp-ui-select-option"
                data-selected={option.value === value || undefined}
                key={option.value}
                onClick={() => {
                  setOpen(false);
                  if (option.value !== value) {
                    onChange(option.value);
                  }
                }}
                role="option"
                title={option.label}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  );
}
