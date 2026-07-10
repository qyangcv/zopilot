import type { SidebarCollectionOption } from "../types";

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

export {
  ROOT_COLLECTION_KEY,
  buildCollectionChildren,
  formatWorkspaceMenuLabel,
};
