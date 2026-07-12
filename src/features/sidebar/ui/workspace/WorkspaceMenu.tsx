import type {
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from "react";
import { getString } from "../../../../app/localization";
import { Icon } from "../Icon";
import type { SidebarCollectionOption, SidebarState } from "../types";
import { FloatingPortal } from "../../../../ui/primitives/index";
import { WorkspaceMenuRow } from "./WorkspaceMenuRow";
import type { WorkspaceMenuModel } from "./useWorkspaceMenuState";
import { ROOT_COLLECTION_KEY } from "./workspaceTree";

function WorkspaceMenu({
  horizontalBoundaryRef,
  model,
  state,
  verticalBoundaryRef,
}: {
  horizontalBoundaryRef?: RefObject<HTMLElement | null>;
  model: WorkspaceMenuModel;
  state: SidebarState;
  verticalBoundaryRef?: RefObject<HTMLElement | null>;
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
          itemCount={collection.itemCount}
          key={collection.key}
          label={collection.label}
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
      horizontalBoundaryRef={horizontalBoundaryRef}
      horizontalMargin={0}
      maxWidth={420}
      minWidth={0}
      onDismiss={() => model.setOpen(false)}
      preferredSide="above"
      verticalBoundaryRef={verticalBoundaryRef}
      width={420}
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
        {model.showItemWorkspace ? (
          <WorkspaceMenuRow
            active={model.workspaceType === "item"}
            iconName="workspaceItem"
            label={model.itemLabel}
            onKeyDown={onKeyDown(() => model.closeAndSelectType("item"))}
            onMouseDown={onMouseDown(() => model.closeAndSelectType("item"))}
            title={model.itemLabel}
          />
        ) : null}
        <WorkspaceMenuRow
          active={model.workspaceType === "library"}
          expanded={model.libraryExpanded}
          hasChildren={Boolean(model.collectionOptions.length)}
          iconName="workspaceLibrary"
          itemCount={state.libraryItemCount}
          label={model.libraryLabel}
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
