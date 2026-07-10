import { type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon } from "./Icon";
import type { SidebarState } from "./types";

export function PromptPicker({
  onClose,
  onInsert,
  prompts,
}: {
  onClose: () => void;
  onInsert: (body: string) => void;
  prompts: SidebarState["prompts"];
}): ReactElement {
  return (
    <section
      aria-label={getString("sidebar-prompts")}
      className="zp-floating-panel zp-prompt-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <FloatingPanelHeader
        onClose={onClose}
        title={getString("sidebar-prompts")}
      />
      <div className="zp-panel-list">
        {prompts.map((prompt) => (
          <div
            className="zp-panel-row zp-prompt-insert-row"
            key={prompt.id}
            onClick={() => onInsert(prompt.body)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onInsert(prompt.body);
              }
            }}
            role="button"
            tabIndex={0}
            title={prompt.body}
          >
            <div className="zp-panel-row-main">
              <span className="zp-panel-row-title">{prompt.title}</span>
              <span className="zp-panel-row-description">{prompt.body}</span>
            </div>
            <span className="zp-panel-row-meta">
              {getString("sidebar-prompt-insert")}
            </span>
          </div>
        ))}
        {prompts.length === 0 ? (
          <div className="zp-command-empty">
            {getString("sidebar-prompt-empty")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function FloatingPanelHeader({
  onClose,
  title,
}: {
  onClose: () => void;
  title: string;
}): ReactElement {
  return (
    <div className="zp-floating-panel-header">
      <span>{title}</span>
      <button
        aria-label={getString("sidebar-close")}
        className="zp-inline-copy"
        onClick={onClose}
        title={getString("sidebar-close")}
        type="button"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
