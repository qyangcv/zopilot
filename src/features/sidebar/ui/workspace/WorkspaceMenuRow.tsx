import type { KeyboardEvent, MouseEvent, ReactElement } from "react";
import { getString } from "../../../../app/localization";
import { Icon, type IconName } from "../Icon";
import { formatWorkspaceMenuLabel } from "./workspaceTree";

function WorkspaceMenuRow({
  active,
  className,
  expanded = false,
  hasChildren = false,
  iconName,
  indent = 0,
  label,
  meta,
  onKeyDown,
  onMouseDown,
  onToggleDisclosure,
  title,
}: {
  active: boolean;
  className?: string;
  expanded?: boolean;
  hasChildren?: boolean;
  iconName: IconName;
  indent?: number;
  label: string;
  meta: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLElement>) => void;
  onToggleDisclosure?: () => void;
  title: string;
}): ReactElement {
  return (
    <div
      aria-expanded={hasChildren ? expanded : undefined}
      className={[
        "zp-workspace-menu-row",
        "zp-workspace-menu-action",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-active={active || undefined}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      role="menuitem"
      tabIndex={0}
      title={title}
    >
      <span
        className="zp-workspace-menu-main"
        style={{ paddingInlineStart: `${10 + indent}px` }}
      >
        <Icon className="zp-workspace-menu-icon" name={iconName} size={14} />
        <span className="zp-workspace-menu-text">
          <span className="zp-workspace-menu-label">
            {formatWorkspaceMenuLabel(label)}
          </span>
          <span className="zp-workspace-menu-meta">{meta}</span>
        </span>
      </span>
      <span className="zp-workspace-menu-check">
        {active ? <Icon name="check" size={13} /> : null}
      </span>
      <WorkspaceDisclosure
        expanded={expanded}
        onToggle={onToggleDisclosure}
        visible={hasChildren}
      />
    </div>
  );
}

function WorkspaceDisclosure({
  expanded,
  onToggle,
  visible,
}: {
  expanded: boolean;
  onToggle?: () => void;
  visible: boolean;
}): ReactElement {
  const title = visible
    ? getString("sidebar-workspace-toggle-collections")
    : undefined;
  if (!visible) {
    return <span className="zp-workspace-menu-expander" />;
  }
  return (
    <button
      aria-expanded={expanded}
      aria-label={title}
      className="zp-workspace-menu-expander"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      title={title}
      type="button"
    >
      <Icon name={expanded ? "collapse" : "expand"} size={13} />
    </button>
  );
}

export { WorkspaceMenuRow };
