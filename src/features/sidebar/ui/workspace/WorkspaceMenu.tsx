import type { KeyboardEvent, MouseEvent, ReactElement, ReactNode } from "react";
import { getString } from "../../../../app/localization";
import { Icon } from "../Icon";
import type { SidebarCollectionOption, SidebarState } from "../types";
import { FloatingPortal } from "../../../../ui/primitives/index";
import { WorkspaceMenuRow } from "./WorkspaceMenuRow";
import type { WorkspaceMenuModel } from "./useWorkspaceMenuState";
import { ROOT_COLLECTION_KEY } from "./workspaceTree";

function WorkspaceMenu({
  model,
  state,
}: {
  model: WorkspaceMenuModel;
  state: SidebarState;
}): ReactElement | null {
  if (!model.open) return null;
  const onKeyDown =
    (action: () => void) => (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      action();
    };
  const onMouseDown =
    (action: () => void) => (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
  const renderCollectionRows = (
    collections: SidebarCollectionOption[],
  ): ReactNode[] =>
    collections.flatMap((collection) => {
      const children = model.collectionChildren.get(collection.key) || [];
      const expanded = model.expandedCollections.has(collection.key);
      const select = () => model.closeAndSelectCollection(collection.key);
      return [
        <WorkspaceMenuRow
          active={
            model.workspaceType === "collection" &&
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
          onKeyDown={onKeyDown(select)}
          onMouseDown={onMouseDown(select)}
          onToggleDisclosure={() => model.toggleCollection(collection.key)}
          title={collection.path.join(" / ")}
        />,
        ...(expanded ? renderCollectionRows(children) : []),
      ];
    });
  const toggleAllLabel = getString(
    model.allCollectionsExpanded
      ? "sidebar-workspace-collapse-all"
      : "sidebar-workspace-expand-all",
  );
  return (
    <FloatingPortal
      align="start"
      anchorRef={model.triggerRef}
      maxWidth={420}
      minWidth={280}
      onDismiss={() => model.setOpen(false)}
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
            model.setOpen(false);
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
                size={15}
              />
            </button>
          </span>
        </div>
        <WorkspaceMenuRow
          active={model.workspaceType === "item"}
          iconName="workspaceItem"
          label={model.itemLabel}
          meta={getString("sidebar-workspace-item")}
          onKeyDown={onKeyDown(() => model.closeAndSelectType("item"))}
          onMouseDown={onMouseDown(() => model.closeAndSelectType("item"))}
          title={model.itemLabel}
        />
        <WorkspaceMenuRow
          active={model.workspaceType === "library"}
          expanded={model.libraryExpanded}
          hasChildren={Boolean(model.collectionOptions.length)}
          iconName="workspaceLibrary"
          label={model.libraryLabel}
          meta={getString("sidebar-workspace-library")}
          onKeyDown={onKeyDown(() => model.closeAndSelectType("library"))}
          onMouseDown={onMouseDown(() => model.closeAndSelectType("library"))}
          onToggleDisclosure={() =>
            model.setLibraryExpanded((expanded) => !expanded)
          }
          title={model.libraryLabel}
        />
        {model.libraryExpanded
          ? renderCollectionRows(
              model.collectionChildren.get(ROOT_COLLECTION_KEY) || [],
            )
          : null}
      </div>
    </FloatingPortal>
  );
}

export { WorkspaceMenu };
