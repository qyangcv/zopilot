import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../shared/conversation";
import {
  createCollectionWorkspaceIdentity,
  createItemWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
} from "../shared/conversation";
import {
  ZoteroCollectionRepository,
  type SourceUniverseCollectionOption,
} from "./sourceUniverseCollections";
import {
  createPaperSourceRefWithZotero,
  dedupeSources,
  paperSourceRefToIdentity,
} from "./sourceUniverseItems";
import { getLibraryLabel, getZoteroGlobal } from "./zoteroEnvironment";

export { ZoteroSourceUniverse };
export {
  createPaperSourceRef,
  paperSourceRefToIdentity,
} from "./sourceUniverseItems";

type SourceUniverseSnapshot = {
  workspace: WorkspaceIdentity;
  sources: PaperSourceRef[];
  collections: SourceUniverseCollectionOption[];
};

class ZoteroSourceUniverse {
  private readonly collections: ZoteroCollectionRepository;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.collections = new ZoteroCollectionRepository(this.zotero);
  }

  async getSnapshot(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }): Promise<SourceUniverseSnapshot> {
    const collections = await this.collections.listOptions(
      input.workspace.libraryID,
    );
    const sources = await this.resolveSources(
      input.workspace,
      input.currentSource,
    );
    return {
      workspace: input.workspace,
      sources,
      collections,
    };
  }

  async createLibraryWorkspace(input: {
    libraryID: number;
    label?: string;
    currentSource?: PaperIdentity;
  }): Promise<WorkspaceIdentity> {
    return {
      ...createLibraryWorkspaceIdentity({
        libraryID: input.libraryID,
        label: input.label || getLibraryLabel(input.libraryID, this.zotero),
      }),
      defaultSource: input.currentSource,
    };
  }

  async createCollectionWorkspace(input: {
    libraryID: number;
    collectionKey: string;
    currentSource?: PaperIdentity;
  }): Promise<WorkspaceIdentity | null> {
    const collection = await this.collections.getWorkspaceInfo(
      input.libraryID,
      input.collectionKey,
    );
    if (!collection) {
      return null;
    }
    return createCollectionWorkspaceIdentity({
      libraryID: input.libraryID,
      collectionKey: input.collectionKey,
      label: collection.label,
      path: collection.path,
      defaultSource: input.currentSource,
    });
  }

  async createItemWorkspace(
    source: PaperSourceRef,
  ): Promise<WorkspaceIdentity> {
    return createItemWorkspaceIdentity(paperSourceRefToIdentity(source));
  }

  async resolveSources(
    workspace: WorkspaceIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    if (workspace.workspaceType === "item") {
      const source = workspace.defaultSource
        ? await this.resolvePaper(workspace.defaultSource, currentSource)
        : null;
      return source ? [source] : [];
    }

    if (workspace.workspaceType === "collection") {
      if (!workspace.collectionKey) {
        return [];
      }
      const items = await this.collections.listItems(
        workspace.libraryID,
        workspace.collectionKey,
      );
      return this.sourcesFromItems(items, currentSource);
    }

    const items = await this.zotero.Items.getAll(
      workspace.libraryID,
      true,
      false,
    );
    return this.sourcesFromItems(items, currentSource);
  }

  private async resolvePaper(
    paper: PaperIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef | null> {
    const parent = this.zotero.Items.get(
      paper.parentItemID || paper.parentItemKey,
    );
    if (!parent) {
      return null;
    }
    return createPaperSourceRefWithZotero(parent, currentSource, this.zotero);
  }

  private async sourcesFromItems(
    items: Zotero.Item[],
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    const sources = items
      .map((item) =>
        createPaperSourceRefWithZotero(item, currentSource, this.zotero),
      )
      .filter((item): item is PaperSourceRef => Boolean(item));
    return dedupeSources(sources).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }
}
