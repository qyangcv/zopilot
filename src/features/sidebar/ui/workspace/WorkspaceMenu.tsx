import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { getString } from "../../../../app/localization";
import {
  FloatingPortal,
  PopupHeader,
  PopupList,
  PopupSurface,
  usePopupListNavigation,
} from "../../../../ui/primitives/index";
import { Icon, type IconName } from "../Icon";
import type { SidebarCollectionOption, SidebarState } from "../types";
import { WorkspaceMenuRow } from "./WorkspaceMenuRow";
import type { WorkspaceMenuModel } from "./useWorkspaceMenuState";
import { ROOT_COLLECTION_KEY } from "./workspaceTree";

type WorkspaceMenuEntry = {
  collection?: SidebarCollectionOption;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  iconName: IconName;
  itemCount?: number;
  key: string;
  kind: "item" | "library" | "collection";
  label: string;
  selected: boolean;
  title: string;
};

function WorkspaceMenu({
  headerBoundaryRef,
  horizontalBoundaryRef,
  model,
  state,
}: {
  headerBoundaryRef?: RefObject<HTMLElement | null>;
  horizontalBoundaryRef?: RefObject<HTMLElement | null>;
  model: WorkspaceMenuModel;
  state: SidebarState;
}): ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(-1);
  const previousOpenRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const entries = buildWorkspaceMenuEntries(model, state);
  const selectedIndex = entries.findIndex((entry) => entry.selected);

  useEffect(() => {
    const opening = model.open && !previousOpenRef.current;
    previousOpenRef.current = model.open;
    if (opening) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [model.open, selectedIndex]);

  const selectEntry = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    if (entry.kind === "collection" && entry.collection) {
      model.closeAndSelectCollection(entry.collection.key);
    } else {
      model.closeAndSelectType(entry.kind);
    }
    queueMicrotask(() =>
      model.triggerRef.current?.focus({ preventScroll: true }),
    );
  };
  const toggleEntry = (entry: WorkspaceMenuEntry) => {
    if (!entry.hasChildren) return;
    if (entry.kind === "library") {
      model.setLibraryExpanded((expanded) => !expanded);
    } else if (entry.collection) {
      model.toggleCollection(entry.collection.key);
    }
  };
  const navigation = usePopupListNavigation({
    activeIndex,
    enabled: model.open,
    itemCount: entries.length,
    itemRefs: rowRefs,
    listRef,
    onActiveIndexChange: setActiveIndex,
    onCollapse: (index) => {
      const entry = entries[index];
      if (!entry) return;
      if (entry.hasChildren && entry.expanded) {
        toggleEntry(entry);
        return;
      }
      if (entry.kind !== "collection") return;
      const parentKey = entry.collection?.parentKey;
      const parentIndex = parentKey
        ? entries.findIndex(
            (candidate) => candidate.collection?.key === parentKey,
          )
        : entries.findIndex((candidate) => candidate.kind === "library");
      if (parentIndex >= 0) setActiveIndex(parentIndex);
    },
    onCommit: selectEntry,
    onDismiss: () => model.setOpen(false),
    onExpand: (index) => {
      const entry = entries[index];
      if (!entry) return;
      if (entry.hasChildren && !entry.expanded) {
        toggleEntry(entry);
      } else if (entry.hasChildren) {
        setActiveIndex(Math.min(index + 1, entries.length - 1));
      }
    },
    restoreFocusRef: model.triggerRef,
  });
  if (!model.open) return null;

  const toggleAllLabel = getString(
    model.allCollectionsExpanded
      ? "sidebar-workspace-collapse-all"
      : "sidebar-workspace-expand-all",
  );
  return (
    <FloatingPortal
      align="stretch"
      anchorRef={horizontalBoundaryRef || model.triggerRef}
      horizontalBoundaryRef={horizontalBoundaryRef}
      horizontalMargin={0}
      maxWidth={720}
      minWidth={0}
      onDismiss={() => model.setOpen(false)}
      preferredSide="above"
      topBoundaryRef={headerBoundaryRef}
      zIndex={8}
    >
      <PopupSurface
        aria-label={getString("sidebar-workspace-choose")}
        className="zp-workspace-menu"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            model.setOpen(false);
            queueMicrotask(() =>
              model.triggerRef.current?.focus({ preventScroll: true }),
            );
            return;
          }
          if (navigation.onKeyDown(event)) {
            queueMicrotask(() =>
              listRef.current?.focus({ preventScroll: true }),
            );
          }
        }}
      >
        <PopupHeader
          actions={
            <button
              aria-label={toggleAllLabel}
              className="zp-workspace-menu-header-action"
              data-popup-action
              disabled={!model.collectionOptions.length}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                model.toggleAllCollections();
              }}
              title={toggleAllLabel}
              type="button"
            >
              <Icon
                name={
                  model.allCollectionsExpanded
                    ? "chevrons-down-up"
                    : "chevrons-up-down"
                }
                size={14}
              />
            </button>
          }
          title={getString("sidebar-workspace-choose")}
        />
        <PopupList
          aria-activedescendant={
            activeIndex >= 0 ? `zp-workspace-option-${activeIndex}` : undefined
          }
          aria-label={getString("sidebar-workspace-choose")}
          id="zp-workspace-tree"
          onKeyDown={navigation.onKeyDown}
          ref={listRef}
          role="tree"
          tabIndex={0}
        >
          {entries.map((entry, index) => (
            <WorkspaceMenuRow
              active={index === activeIndex}
              className={
                entry.kind === "collection"
                  ? "zp-workspace-menu-collection"
                  : undefined
              }
              depth={entry.depth}
              expanded={entry.expanded}
              hasChildren={entry.hasChildren}
              iconName={entry.iconName}
              itemCount={entry.itemCount}
              key={entry.key}
              label={entry.label}
              onMouseEnter={() => setActiveIndex(index)}
              onSelect={() => selectEntry(index)}
              onToggleDisclosure={() => toggleEntry(entry)}
              optionId={`zp-workspace-option-${index}`}
              rowRef={(element) => {
                rowRefs.current[index] = element;
              }}
              selected={entry.selected}
              title={entry.title}
            />
          ))}
        </PopupList>
      </PopupSurface>
    </FloatingPortal>
  );
}

function buildWorkspaceMenuEntries(
  model: WorkspaceMenuModel,
  state: SidebarState,
): WorkspaceMenuEntry[] {
  const entries: WorkspaceMenuEntry[] = [];
  if (model.showItemWorkspace) {
    entries.push({
      depth: 0,
      expanded: false,
      hasChildren: false,
      iconName: "workspaceItem",
      key: "item",
      kind: "item",
      label: model.itemLabel,
      selected: model.workspaceType === "item",
      title: model.itemLabel,
    });
  }
  entries.push({
    depth: 0,
    expanded: model.libraryExpanded,
    hasChildren: Boolean(model.collectionOptions.length),
    iconName: "workspaceLibrary",
    itemCount: state.libraryItemCount,
    key: "library",
    kind: "library",
    label: model.libraryLabel,
    selected: model.workspaceType === "library",
    title: model.libraryLabel,
  });
  if (!model.libraryExpanded) return entries;

  const appendCollections = (collections: SidebarCollectionOption[]) => {
    for (const collection of collections) {
      const children = model.collectionChildren.get(collection.key) || [];
      const expanded = model.expandedCollections.has(collection.key);
      entries.push({
        collection,
        depth: collection.level + 1,
        expanded,
        hasChildren: collection.hasChildren,
        iconName: "workspaceCollection",
        itemCount: collection.itemCount,
        key: `collection:${collection.key}`,
        kind: "collection",
        label: collection.label,
        selected:
          model.workspaceType === "collection" &&
          state.context.collectionKey === collection.key,
        title: collection.path.join(" / "),
      });
      if (expanded) appendCollections(children);
    }
  };
  appendCollections(model.collectionChildren.get(ROOT_COLLECTION_KEY) || []);
  return entries;
}

export { WorkspaceMenu, buildWorkspaceMenuEntries };
