import { useState, type ReactElement } from "react";
import { Icon } from "../Icon";
import { DismissLayer, Portal } from "./Provider";

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
  title,
  value,
}: {
  "aria-label": string;
  disabled?: boolean;
  onChange: (value: string) => void;
  options: SelectOption[];
  title: string;
  value: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <span className="zp-ui-select">
      <button
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="zp-composer-select"
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
        title={title}
        type="button"
      >
        <span className="zp-ui-select-label">
          {selected?.label || value || title}
        </span>
        <Icon className="zp-ui-select-icon" name="expand" size={11} />
      </button>
      {open ? (
        <Portal>
          <DismissLayer onDismiss={() => setOpen(false)}>
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
          </DismissLayer>
        </Portal>
      ) : null}
    </span>
  );
}
