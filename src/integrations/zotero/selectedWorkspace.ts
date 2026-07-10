import type { WorkspaceIdentity } from "../../domain/conversation";

type WorkspaceFactory = {
  createLibraryWorkspace(input: {
    libraryID: number;
    label?: string;
  }): Promise<WorkspaceIdentity>;
  createCollectionWorkspace(input: {
    libraryID: number;
    collectionKey: string;
  }): Promise<WorkspaceIdentity | null>;
};

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

async function resolveSelectedWorkspace(
  win: Window,
  factory: WorkspaceFactory,
): Promise<SelectedWorkspaceResult> {
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
    const workspace = await factory.createCollectionWorkspace({
      libraryID,
      collectionKey: ref.key,
    });
    return workspace
      ? { status: "ready", rowID, label, workspace }
      : { status: "unavailable", rowID, label };
  }

  if (row.isLibrary() || row.isGroup()) {
    return {
      status: "ready",
      rowID,
      label,
      workspace: await factory.createLibraryWorkspace({ libraryID, label }),
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
export type { SelectedWorkspaceResult, WorkspaceFactory };
