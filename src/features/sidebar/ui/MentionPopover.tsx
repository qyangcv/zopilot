import { useEffect, useRef, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { PaperSourceRef } from "../../../domain/conversation";
import {
  PopupList,
  PopupRow,
  PopupSurface,
} from "../../../ui/primitives/index";
import { Icon } from "./Icon";

export function MentionPopover({
  activeIndex,
  candidates,
  disabled,
  onActiveIndexChange,
  onClose,
  onSelect,
}: {
  activeIndex: number;
  candidates: PaperSourceRef[];
  disabled: boolean;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onSelect: (source: PaperSourceRef) => void;
}): ReactElement {
  const activeOptionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <PopupSurface
      className="zp-mention-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {disabled ? (
        <div className="zp-mention-limit">
          {getString("sidebar-mention-limit")}
        </div>
      ) : null}
      <PopupList
        aria-activedescendant={`zp-mention-option-${activeIndex}`}
        id="zp-mention-listbox"
        role="listbox"
      >
        {candidates.map((source, index) => (
          <PopupRow
            active={index === activeIndex}
            aria-selected={index === activeIndex}
            className="zp-mention-option"
            disabled={disabled}
            icon={
              <Icon className="zp-mention-icon" name="paperMention" size={14} />
            }
            id={`zp-mention-option-${index}`}
            key={source.sourceId}
            label={source.title}
            onMouseEnter={() => onActiveIndexChange(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              if (!disabled) onSelect(source);
            }}
            ref={index === activeIndex ? activeOptionRef : undefined}
            role="option"
            tabIndex={-1}
            title={source.title}
          />
        ))}
      </PopupList>
    </PopupSurface>
  );
}
