import type { CSSProperties, MouseEvent, ReactElement, Ref } from "react";
import { getString } from "../../../../app/localization";
import { PopupRow } from "../../../../ui/primitives/index";
import { Icon, type IconName } from "../Icon";
import { formatWorkspaceMenuLabel } from "./workspaceTree";

function WorkspaceMenuRow({
  active,
  className,
  depth = 0,
  expanded = false,
  hasChildren = false,
  iconName,
  itemCount,
  label,
  mergeLeadingColumns = false,
  onMouseEnter,
  onSelect,
  onToggleDisclosure,
  optionId,
  rowRef,
  selected,
  title,
}: {
  active: boolean;
  className?: string;
  depth?: number;
  expanded?: boolean;
  hasChildren?: boolean;
  iconName: IconName;
  itemCount?: number;
  label: string;
  mergeLeadingColumns?: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  onToggleDisclosure?: () => void;
  optionId: string;
  rowRef?: Ref<HTMLDivElement>;
  selected: boolean;
  title: string;
}): ReactElement {
  const disclosure = (
    <WorkspaceDisclosure
      expanded={expanded}
      onToggle={onToggleDisclosure}
      visible={hasChildren}
    />
  );
  return (
    <PopupRow
      active={active}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      className={["zp-workspace-menu-row", className].filter(Boolean).join(" ")}
      disclosure={mergeLeadingColumns ? undefined : disclosure}
      icon={
        <Icon className="zp-workspace-menu-icon" name={iconName} size={14} />
      }
      id={optionId}
      label={formatWorkspaceMenuLabel(label)}
      metadata={
        itemCount === undefined ? null : (
          <span
            className="zp-workspace-menu-count"
            data-compact={itemCount >= 10 || undefined}
          >
            {String(itemCount)}
          </span>
        )
      }
      onMouseEnter={onMouseEnter}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSelect();
      }}
      ref={rowRef}
      role="treeitem"
      selected={selected}
      selection={
        mergeLeadingColumns ? (
          hasChildren ? (
            disclosure
          ) : selected ? (
            <Icon name="check" size={13} />
          ) : null
        ) : selected ? (
          <Icon name="check" size={13} />
        ) : null
      }
      style={
        {
          "--zp-workspace-depth": depth,
          "--zp-workspace-indent": `${Math.max(depth - 1, 0) * 16}px`,
        } as CSSProperties
      }
      tabIndex={-1}
      title={title}
    />
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
}): ReactElement | null {
  if (!visible) return null;
  const title = getString("sidebar-workspace-toggle-collections");
  const stopAndToggle = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle?.();
  };
  return (
    <span
      aria-expanded={expanded}
      aria-label={title}
      className="zp-workspace-menu-expander"
      onMouseDown={stopAndToggle}
      role="button"
      title={title}
    >
      <Icon name={expanded ? "collapse" : "expand"} size={13} />
    </span>
  );
}

export { WorkspaceMenuRow };
