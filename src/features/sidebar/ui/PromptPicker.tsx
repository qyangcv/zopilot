import { useRef, useState, type ReactElement, type RefObject } from "react";
import { getString } from "../../../app/localization";
import {
  PopupHeader,
  PopupList,
  PopupRow,
  PopupSurface,
  usePopupListNavigation,
} from "../../../ui/primitives/index";
import { Icon } from "./Icon";
import type { SidebarState } from "./types";

export function PromptPicker({
  onClose,
  onInsert,
  prompts,
  triggerRef,
}: {
  onClose: () => void;
  onInsert: (body: string) => void;
  prompts: SidebarState["prompts"];
  triggerRef: RefObject<HTMLButtonElement | null>;
}): ReactElement {
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const navigation = usePopupListNavigation({
    activeIndex,
    itemCount: prompts.length,
    itemRefs: rowRefs,
    listRef,
    onActiveIndexChange: setActiveIndex,
    onCommit: (index) => {
      const prompt = prompts[index];
      if (prompt) onInsert(prompt.body);
    },
    onDismiss: onClose,
    restoreFocusRef: triggerRef,
  });
  const closeAndRestore = () => {
    onClose();
    queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
  };
  return (
    <PopupSurface
      aria-label={getString("sidebar-prompts")}
      className="zp-floating-panel zp-prompt-picker"
      id="zp-prompt-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeAndRestore();
          return;
        }
        if (navigation.onKeyDown(event)) {
          queueMicrotask(() => listRef.current?.focus({ preventScroll: true }));
        }
      }}
      role="dialog"
    >
      <PopupHeader
        actions={
          <button
            aria-label={getString("sidebar-close")}
            className="zp-inline-copy"
            data-popup-action
            onClick={closeAndRestore}
            title={getString("sidebar-close")}
            type="button"
          >
            <Icon name="close" size={13} />
          </button>
        }
        title={getString("sidebar-prompts")}
      />
      <PopupList
        aria-activedescendant={
          activeIndex >= 0 ? `zp-prompt-option-${activeIndex}` : undefined
        }
        aria-label={getString("sidebar-prompts")}
        className="zp-panel-list"
        onKeyDown={navigation.onKeyDown}
        ref={listRef}
        role="listbox"
        tabIndex={0}
      >
        {prompts.map((prompt, index) => (
          <PopupRow
            active={index === activeIndex}
            aria-selected={false}
            className="zp-panel-row zp-prompt-insert-row"
            description={prompt.body}
            id={`zp-prompt-option-${index}`}
            key={prompt.id}
            label={prompt.title}
            onClick={() => onInsert(prompt.body)}
            onMouseEnter={() => setActiveIndex(index)}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            role="option"
            tabIndex={-1}
            title={prompt.body}
          />
        ))}
        {prompts.length === 0 ? (
          <div className="zp-popup-empty">
            {getString("sidebar-prompt-empty")}
          </div>
        ) : null}
      </PopupList>
    </PopupSurface>
  );
}
