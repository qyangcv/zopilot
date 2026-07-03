import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { getString } from "../../../utils/locale";
import type { WorkspaceType } from "../../../shared/conversation";
import { Icon, type IconName } from "./Icon";
import { FloatingPortal } from "./ui/index";
import type {
  SidebarActions,
  SidebarCollectionOption,
  SidebarState,
} from "./types";

export function WorkspaceSelector({
  actions,
  state,
}: {
  actions: SidebarActions;
  state: SidebarState;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(),
  );
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const workspaceType = state.context.workspaceType || "item";
  const collectionOptions = state.collectionOptions || [];
  const currentCollection = collectionOptions.find(
    (collection) => collection.key === state.context.collectionKey,
  );
  const itemLabel =
    state.context.paperTitle ||
    state.context.label ||
    state.context.paperKey ||
    getString("sidebar-unavailable-context");
  const libraryLabel = getString("sidebar-workspace-my-library");
  const workspaceLabel = !hasWorkspace
    ? getString("sidebar-workspace-unavailable")
    : workspaceType === "library"
      ? libraryLabel
      : workspaceType === "collection"
        ? currentCollection?.label || state.context.label
        : itemLabel;
  const workspaceTypeLabel = getWorkspaceTypeLabel(workspaceType);
  const workspaceTooltip = hasWorkspace
    ? `${getString("sidebar-workspace-current")}: ${workspaceTypeLabel} - ${
        workspaceLabel
      }`
    : getString("sidebar-workspace-unavailable");

  useEffect(() => {
    if (!open) {
      return;
    }
    setLibraryExpanded(false);
    setExpandedCollections(new Set());
  }, [collectionOptions, open]);

  const selectWorkspaceType = (type: WorkspaceType) => {
    setOpen(false);
    actions.selectWorkspaceMode(type);
  };

  const selectCollection = (collectionKey: string) => {
    setOpen(false);
    actions.selectCollectionWorkspace(collectionKey);
  };
  const selectLibrary = () => {
    setOpen(false);
    actions.selectWorkspaceMode("library");
  };
  const toggleCollection = (collectionKey: string) => {
    setExpandedCollections((current) => {
      const next = new Set(current);
      if (current.has(collectionKey)) {
        next.delete(collectionKey);
      } else {
        next.add(collectionKey);
      }
      return next;
    });
  };
  const expandAllCollections = () => {
    setLibraryExpanded(true);
    setExpandedCollections(
      new Set(
        collectionOptions
          .filter((collection) => collection.hasChildren)
          .map((collection) => collection.key),
      ),
    );
  };
  const collapseAllCollections = () => {
    setLibraryExpanded(false);
    setExpandedCollections(new Set());
  };
  const expandableCollectionKeys = collectionOptions
    .filter((collection) => collection.hasChildren)
    .map((collection) => collection.key);
  const allCollectionsExpanded =
    Boolean(collectionOptions.length) &&
    libraryExpanded &&
    expandableCollectionKeys.every((key) => expandedCollections.has(key));
  const toggleAllCollections = () => {
    if (allCollectionsExpanded) {
      collapseAllCollections();
    } else {
      expandAllCollections();
    }
  };
  const toggleAllLabel = getString(
    allCollectionsExpanded
      ? "sidebar-workspace-collapse-all"
      : "sidebar-workspace-expand-all",
  );
  const onMenuRowKeyDown =
    (action: () => void) => (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      action();
    };
  const onMenuRowMouseDown =
    (action: () => void) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
  const collectionChildren = buildCollectionChildren(collectionOptions);
  const renderCollectionRows = (
    collections: SidebarCollectionOption[],
  ): ReactNode[] =>
    collections.flatMap((collection) => {
      const children = collectionChildren.get(collection.key) || [];
      const expanded = expandedCollections.has(collection.key);
      const selectCollectionRow = () => {
        selectCollection(collection.key);
      };
      return [
        <WorkspaceMenuRow
          active={
            workspaceType === "collection" &&
            state.context.collectionKey === collection.key
          }
          className="zp-workspace-menu-collection"
          expanded={expanded}
          hasChildren={collection.hasChildren}
          iconName="workspaceCollection"
          indent={(collection.level + 1) * 18}
          key={collection.key}
          label={collection.label}
          meta={getString("sidebar-workspace-collection")}
          onKeyDown={onMenuRowKeyDown(selectCollectionRow)}
          onMouseDown={onMenuRowMouseDown(selectCollectionRow)}
          onToggleDisclosure={() => toggleCollection(collection.key)}
          title={collection.path.join(" / ")}
        />,
        ...(expanded ? renderCollectionRows(children) : []),
      ];
    });

  return (
    <div
      className="zp-workspace-selector"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label={getString("sidebar-workspace-current")}
        aria-expanded={open}
        aria-haspopup="menu"
        className="zp-workspace-trigger"
        data-popup-open={open || undefined}
        data-workspace-type={workspaceType}
        disabled={!hasWorkspace}
        onClick={() => {
          if (!open) {
            collapseAllCollections();
          }
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        ref={triggerRef}
        title={workspaceTooltip}
        type="button"
      >
        <Icon
          className="zp-workspace-trigger-icon"
          name="workspace"
          size={15}
        />
        <span className="zp-workspace-trigger-main">
          <span className="zp-workspace-trigger-label">
            {getString("sidebar-chat-workspace")}
          </span>
          <span className="zp-workspace-trigger-text">{workspaceLabel}</span>
        </span>
        <span className="zp-workspace-type-badge">{workspaceTypeLabel}</span>
        <Icon
          className="zp-workspace-trigger-chevron"
          name={open ? "collapse" : "expand"}
          size={12}
        />
      </button>
      {open ? (
        <FloatingPortal
          align="start"
          anchorRef={triggerRef}
          maxWidth={420}
          minWidth={280}
          onDismiss={() => setOpen(false)}
          preferredSide="above"
          width={320}
          zIndex={8}
        >
          <div
            className="zp-workspace-menu"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
            }}
            role="menu"
          >
            <div className="zp-workspace-menu-header">
              <span>{getString("sidebar-workspace-choose")}</span>
              <span className="zp-workspace-menu-header-actions">
                <button
                  aria-label={toggleAllLabel}
                  className="zp-workspace-menu-header-action"
                  disabled={!collectionOptions.length}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleAllCollections();
                  }}
                  title={toggleAllLabel}
                  type="button"
                >
                  <Icon
                    name={
                      allCollectionsExpanded
                        ? "chevrons-down-up"
                        : "chevrons-up-down"
                    }
                    size={15}
                  />
                </button>
              </span>
            </div>
            <WorkspaceMenuRow
              active={workspaceType === "item"}
              iconName="workspaceItem"
              label={itemLabel}
              meta={getString("sidebar-workspace-item")}
              onKeyDown={onMenuRowKeyDown(() => selectWorkspaceType("item"))}
              onMouseDown={onMenuRowMouseDown(() =>
                selectWorkspaceType("item"),
              )}
              title={itemLabel}
            />
            <WorkspaceMenuRow
              active={workspaceType === "library"}
              expanded={libraryExpanded}
              hasChildren={Boolean(collectionOptions.length)}
              iconName="workspaceLibrary"
              label={libraryLabel}
              meta={getString("sidebar-workspace-library")}
              onKeyDown={onMenuRowKeyDown(selectLibrary)}
              onMouseDown={onMenuRowMouseDown(selectLibrary)}
              onToggleDisclosure={() =>
                setLibraryExpanded((expanded) => !expanded)
              }
              title={libraryLabel}
            />
            {libraryExpanded
              ? renderCollectionRows(
                  collectionChildren.get(ROOT_COLLECTION_KEY) || [],
                )
              : null}
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  );
}

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
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
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

function getWorkspaceTypeLabel(type: WorkspaceType): string {
  if (type === "library") {
    return getString("sidebar-workspace-library");
  }
  if (type === "collection") {
    return getString("sidebar-workspace-collection");
  }
  return getString("sidebar-workspace-item");
}

const ROOT_COLLECTION_KEY = "";

function formatWorkspaceMenuLabel(label: string): string {
  const maxLength = 42;
  return label.length > maxLength
    ? `${label.slice(0, maxLength - 3)}...`
    : label;
}

function buildCollectionChildren(
  collections: SidebarCollectionOption[],
): Map<string, SidebarCollectionOption[]> {
  const byParent = new Map<string, SidebarCollectionOption[]>();
  for (const collection of collections) {
    const parentKey = collection.parentKey || ROOT_COLLECTION_KEY;
    const children = byParent.get(parentKey) || [];
    children.push(collection);
    byParent.set(parentKey, children);
  }
  return byParent;
}
