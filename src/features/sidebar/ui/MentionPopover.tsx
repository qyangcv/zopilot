import { useEffect, useRef, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type { PaperSourceRef } from "../../../domain/conversation";

export function MentionPopover({
  activeIndex,
  candidates,
  disabled,
  onClose,
  onSelect,
}: {
  activeIndex: number;
  candidates: PaperSourceRef[];
  disabled: boolean;
  onClose: () => void;
  onSelect: (source: PaperSourceRef) => void;
}): ReactElement {
  const activeOptionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      className="zp-mention-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="listbox"
    >
      {disabled ? (
        <div className="zp-mention-limit">
          {getString("sidebar-mention-limit")}
        </div>
      ) : null}
      {candidates.map((source, index) => (
        <div
          aria-disabled={disabled || undefined}
          aria-selected={index === activeIndex}
          className="zp-mention-option"
          data-active={index === activeIndex || undefined}
          key={source.sourceId}
          onMouseDown={(event) => {
            event.preventDefault();
            if (disabled) {
              return;
            }
            onSelect(source);
          }}
          role="option"
          ref={index === activeIndex ? activeOptionRef : undefined}
          tabIndex={-1}
          title={source.title}
        >
          <span className="zp-mention-title">{source.title}</span>
          <span className="zp-mention-meta">
            {[source.year, source.creators?.[0]].filter(Boolean).join(" · ")}
          </span>
        </div>
      ))}
    </div>
  );
}
