import { useRef, useState } from "react";
import { getString } from "../../../../app/localization";
import type { WorkspaceType } from "../../../../domain/conversation";
import type {
  SidebarActions,
  SidebarCollectionOption,
  SidebarState,
} from "../types";
import { buildCollectionChildren } from "./workspaceTree";

function useWorkspaceMenuState(actions: SidebarActions, state: SidebarState) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(
    () => new Set(),
  );
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const showItemWorkspace = state.context.hostContextKind !== "library";
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
  const workspaceTypeLabel = getWorkspaceTypeLabel(
    workspaceType,
    currentCollection?.level,
  );
  const workspaceItemCount = !hasWorkspace
    ? undefined
    : workspaceType === "library"
      ? state.libraryItemCount
      : workspaceType === "collection"
        ? currentCollection?.itemCount
        : 1;
  const workspaceTooltip = hasWorkspace
    ? getString("sidebar-workspace-tooltip", {
        args: { label: workspaceLabel, type: workspaceTypeLabel },
      })
    : getString("sidebar-workspace-unavailable");

  const openToCurrentWorkspace = () => {
    const expansion = getWorkspaceMenuExpansion(
      workspaceType,
      state.context.collectionKey,
      collectionOptions,
    );
    setLibraryExpanded(expansion.libraryExpanded);
    setExpandedCollections(expansion.expandedCollections);
    setOpen(true);
  };

  const closeAndSelectType = (type: WorkspaceType) => {
    setOpen(false);
    actions.selectWorkspaceMode(type);
  };
  const closeAndSelectCollection = (collectionKey: string) => {
    setOpen(false);
    actions.selectCollectionWorkspace(collectionKey);
  };
  const toggleCollection = (collectionKey: string) => {
    setExpandedCollections((current) => {
      const next = new Set(current);
      if (current.has(collectionKey)) next.delete(collectionKey);
      else next.add(collectionKey);
      return next;
    });
  };
  const expandableCollectionKeys = collectionOptions
    .filter((collection) => collection.hasChildren)
    .map((collection) => collection.key);
  const allCollectionsExpanded =
    Boolean(collectionOptions.length) &&
    libraryExpanded &&
    expandableCollectionKeys.every((key) => expandedCollections.has(key));
  const collapseAllCollections = () => {
    setLibraryExpanded(false);
    setExpandedCollections(new Set());
  };
  const toggleAllCollections = () => {
    if (allCollectionsExpanded) {
      collapseAllCollections();
      return;
    }
    setLibraryExpanded(true);
    setExpandedCollections(new Set(expandableCollectionKeys));
  };

  return {
    allCollectionsExpanded,
    closeAndSelectCollection,
    closeAndSelectType,
    collapseAllCollections,
    collectionChildren: buildCollectionChildren(collectionOptions),
    collectionOptions,
    expandedCollections,
    hasWorkspace,
    itemLabel,
    libraryExpanded,
    libraryLabel,
    open,
    openToCurrentWorkspace,
    setLibraryExpanded,
    setOpen,
    showItemWorkspace,
    toggleAllCollections,
    toggleCollection,
    triggerRef,
    workspaceLabel,
    workspaceItemCount,
    workspaceTooltip,
    workspaceType,
    workspaceTypeLabel,
  };
}

function getWorkspaceTypeLabel(type: WorkspaceType, level?: number): string {
  if (type === "library") return getString("sidebar-workspace-library");
  if (type === "collection") {
    return getString(
      level && level > 0
        ? "sidebar-workspace-subcollection"
        : "sidebar-workspace-collection",
    );
  }
  return getString("sidebar-workspace-item");
}

function getWorkspaceMenuExpansion(
  workspaceType: WorkspaceType,
  collectionKey: string | undefined,
  collectionOptions: SidebarCollectionOption[],
): {
  libraryExpanded: boolean;
  expandedCollections: Set<string>;
} {
  if (workspaceType !== "collection" || !collectionKey) {
    return { libraryExpanded: false, expandedCollections: new Set() };
  }
  const byKey = new Map(
    collectionOptions.map((option) => [option.key, option]),
  );
  const expandedCollections = new Set<string>();
  let parentKey = byKey.get(collectionKey)?.parentKey;
  while (parentKey) {
    expandedCollections.add(parentKey);
    parentKey = byKey.get(parentKey)?.parentKey;
  }
  return { libraryExpanded: true, expandedCollections };
}

type WorkspaceMenuModel = ReturnType<typeof useWorkspaceMenuState>;

export { getWorkspaceMenuExpansion, useWorkspaceMenuState };
export type { WorkspaceMenuModel, SidebarCollectionOption };
