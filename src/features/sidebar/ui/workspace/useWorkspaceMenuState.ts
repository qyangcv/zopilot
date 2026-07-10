import { useEffect, useRef, useState } from "react";
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
    if (open) {
      setLibraryExpanded(false);
      setExpandedCollections(new Set());
    }
  }, [collectionOptions, open]);

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
    setLibraryExpanded,
    setOpen,
    toggleAllCollections,
    toggleCollection,
    triggerRef,
    workspaceLabel,
    workspaceTooltip,
    workspaceType,
    workspaceTypeLabel,
  };
}

function getWorkspaceTypeLabel(type: WorkspaceType): string {
  if (type === "library") return getString("sidebar-workspace-library");
  if (type === "collection") return getString("sidebar-workspace-collection");
  return getString("sidebar-workspace-item");
}

type WorkspaceMenuModel = ReturnType<typeof useWorkspaceMenuState>;

export { useWorkspaceMenuState };
export type { WorkspaceMenuModel, SidebarCollectionOption };
