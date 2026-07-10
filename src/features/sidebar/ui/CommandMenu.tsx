import { type ReactElement } from "react";
import { getString } from "../../../app/localization";
import { Icon, type IconName } from "./Icon";
import type { SidebarCommandView } from "./types";

export function CommandMenu({
  commands,
  onClose,
  onSelect,
}: {
  commands: SidebarCommandView[];
  onClose: () => void;
  onSelect: (command: SidebarCommandView) => void;
}): ReactElement {
  return (
    <div
      aria-label={getString("sidebar-command-menu")}
      className="zp-command-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      role="dialog"
    >
      <div className="zp-command-menu-header">
        <span>{getString("sidebar-command-menu")}</span>
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
      <div className="zp-command-list" role="listbox">
        {commands.length ? (
          commands.slice(0, 8).map((command, index) => (
            <button
              aria-disabled={!command.available}
              className="zp-command-row"
              data-active={index === 0 || undefined}
              disabled={!command.available}
              key={command.id}
              onClick={() => onSelect(command)}
              role="option"
              title={command.disabledReason || command.description}
              type="button"
            >
              <Icon name={command.icon as IconName} size={14} />
              <span className="zp-command-main">
                <span className="zp-command-title">{command.title}</span>
                <span className="zp-command-description">
                  {command.disabledReason || command.description}
                </span>
              </span>
              <span className="zp-command-category">
                {getCommandCategoryLabel(command.category)}
              </span>
            </button>
          ))
        ) : (
          <div className="zp-command-empty">
            {getString("sidebar-command-empty")}
          </div>
        )}
      </div>
    </div>
  );
}

function getCommandCategoryLabel(
  category: SidebarCommandView["category"],
): string {
  switch (category) {
    case "source":
      return getString("sidebar-command-category-source");
    case "reader":
      return getString("sidebar-command-category-reader");
    case "attachment":
      return getString("sidebar-command-category-attachment");
    case "session":
      return getString("sidebar-command-category-session");
    case "prompt":
      return getString("sidebar-command-category-prompt");
  }
}
