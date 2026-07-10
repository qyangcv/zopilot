import {
  createCollectionWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
  type WorkspaceIdentity,
} from "../../domain/conversation";

type SelectedWorkspaceResult =
  | {
      status: "ready";
      rowID: string;
      label: string;
      workspace: WorkspaceIdentity;
    }
  | {
      status: "unsupported" | "unavailable";
      rowID?: string;
      label: string;
    };

function resolveSelectedWorkspace(win: Window): SelectedWorkspaceResult {
  const pane = (win as Window & { ZoteroPane?: _ZoteroTypes.ZoteroPane })
    .ZoteroPane;
  const row = pane?.getCollectionTreeRow?.() as
    | Zotero.CollectionTreeRow
    | undefined;
  if (!row) {
    return {
      status: "unavailable",
      label: "No Zotero workspace selected",
    };
  }

  const rowID = row.id;
  const label = row.getName?.() || "Zotero workspace";
  const ref = row.ref as {
    key?: string;
    libraryID?: number;
  };
  const libraryID = ref?.libraryID;
  if (typeof libraryID !== "number") {
    return { status: "unsupported", rowID, label };
  }

  if (row.isCollection()) {
    if (!ref.key) return { status: "unsupported", rowID, label };
    return {
      status: "ready",
      rowID,
      label,
      workspace: createCollectionWorkspaceIdentity({
        libraryID,
        collectionKey: ref.key,
        label,
      }),
    };
  }

  if (row.isLibrary() || row.isGroup()) {
    return {
      status: "ready",
      rowID,
      label,
      workspace: createLibraryWorkspaceIdentity({ libraryID, label }),
    };
  }

  return { status: "unsupported", rowID, label };
}

function isLibraryTab(win: Window): boolean {
  const tabs = (
    win as Window & {
      Zotero_Tabs?: { selectedID?: string; selectedType?: string };
    }
  ).Zotero_Tabs;
  return (
    tabs?.selectedID === "zotero-pane" ||
    tabs?.selectedType === "library" ||
    tabs?.selectedType === "zotero-pane"
  );
}

export { isLibraryTab, resolveSelectedWorkspace };
export type { SelectedWorkspaceResult };
