import { useEffect, useRef, type ReactElement } from "react";
import { getString } from "../../../app/localization";
import type {
  ItemContextNode,
  ItemContextTree,
} from "../../../domain/conversation";
import {
  PopupList,
  PopupRow,
  PopupSurface,
} from "../../../ui/primitives/index";
import { Icon } from "./Icon";

function ItemContextMentionPopover({
  activeIndex,
  expanded,
  limitReached,
  nodes,
  onActiveIndexChange,
  onClose,
  onSelect,
  onToggle,
  selectedNodeIds,
  tree,
}: {
  activeIndex: number;
  expanded: boolean;
  limitReached: boolean;
  nodes: ItemContextNode[];
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onSelect: (node: ItemContextNode, options?: { keepOpen?: boolean }) => void;
  onToggle: () => void;
  selectedNodeIds: ReadonlySet<string>;
  tree: ItemContextTree;
}): ReactElement {
  const activeOptionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <PopupSurface
      className="zp-mention-popover zp-item-context-tree"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {limitReached ? (
        <div className="zp-mention-limit">
          {getString("sidebar-mention-limit")}
        </div>
      ) : null}
      <PopupList
        aria-activedescendant={`zp-item-context-option-${activeIndex}`}
        id="zp-item-context-tree"
        role="tree"
      >
        <PopupRow
          active={activeIndex === 0}
          aria-expanded={expanded}
          aria-selected={activeIndex === 0}
          className="zp-mention-option zp-item-context-root"
          disclosure={
            <Icon
              className="zp-item-context-chevron"
              name={expanded ? "collapse" : "expand"}
              size={13}
            />
          }
          icon={
            <Icon className="zp-mention-icon" name="workspaceItem" size={14} />
          }
          id="zp-item-context-option-0"
          label={tree.root.title}
          onMouseEnter={() => onActiveIndexChange(0)}
          onMouseDown={(event) => {
            event.preventDefault();
            onToggle();
          }}
          ref={activeIndex === 0 ? activeOptionRef : undefined}
          role="treeitem"
          selection={null}
          tabIndex={-1}
          title={tree.root.title}
        />
        {expanded ? (
          nodes.length ? (
            <div role="group">
              {nodes.map((node, index) => {
                const rowIndex = index + 1;
                const selected =
                  node.selectable &&
                  ((node.kind === "pdf" && node.current) ||
                    selectedNodeIds.has(node.id));
                const disabled =
                  !node.selectable || (limitReached && !selected);
                const metadata =
                  node.kind === "note" && node.invalidReason
                    ? getString("sidebar-item-context-note-unavailable")
                    : "disabledReason" in node && node.disabledReason
                      ? getString(
                          node.disabledReason === "file-unavailable"
                            ? "sidebar-item-context-file-unavailable"
                            : "sidebar-item-context-unsupported",
                        )
                      : node.kind === "pdf" && node.current
                        ? getString("sidebar-item-context-default-source")
                        : undefined;
                return (
                  <PopupRow
                    active={rowIndex === activeIndex}
                    aria-selected={selected}
                    className="zp-mention-option zp-item-context-child"
                    data-invalid={
                      node.kind === "note" && node.invalidReason
                        ? true
                        : undefined
                    }
                    disabled={disabled}
                    disclosure={null}
                    icon={
                      <Icon
                        className="zp-mention-icon"
                        name={iconForNode(node)}
                        size={14}
                      />
                    }
                    id={`zp-item-context-option-${rowIndex}`}
                    key={node.id}
                    label={node.title}
                    metadata={metadata}
                    onMouseEnter={() => onActiveIndexChange(rowIndex)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      if (!disabled) onSelect(node, { keepOpen: true });
                    }}
                    ref={rowIndex === activeIndex ? activeOptionRef : undefined}
                    role="treeitem"
                    selected={selected}
                    selection={
                      <Icon
                        className="zp-item-context-selection"
                        name={selected ? "squareCheck" : "square"}
                        size={14}
                      />
                    }
                    tabIndex={-1}
                    title={node.title}
                  />
                );
              })}
            </div>
          ) : (
            <div className="zp-popup-empty">
              {getString("sidebar-item-context-empty")}
            </div>
          )
        ) : null}
      </PopupList>
    </PopupSurface>
  );
}

function iconForNode(
  node: ItemContextNode,
): "file" | "notebookText" | "paperclip" {
  if (node.kind === "pdf") return "file";
  if (node.kind === "note") return "notebookText";
  return "paperclip";
}

export { ItemContextMentionPopover };
