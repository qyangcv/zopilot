import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import {
  ZoteroCollectionRepository,
  type SourceUniverseCollectionOption,
} from "./ZoteroCollectionRepository";
import { createPaperSourceRefWithZotero, dedupeSources } from "./items";
import { getZoteroGlobal } from "../environment";

type SourceUniverseSnapshot = {
  workspace: WorkspaceIdentity;
  sources: PaperSourceRef[];
  collections: SourceUniverseCollectionOption[];
};

class ZoteroSourceCatalog {
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
      return this.sourcesFromItems(
        await this.collections.listItems(
          workspace.libraryID,
          workspace.collectionKey,
        ),
        currentSource,
      );
    }
    return this.sourcesFromItems(
      await this.zotero.Items.getAll(workspace.libraryID, true, false),
      currentSource,
    );
  }

  private async resolvePaper(
    paper: PaperIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef | null> {
    const parent = this.zotero.Items.get(
      paper.parentItemID || paper.parentItemKey,
    );
    return parent
      ? createPaperSourceRefWithZotero(parent, currentSource, this.zotero)
      : null;
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

export { ZoteroSourceCatalog };
export type { SourceUniverseSnapshot };
