import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import {
  getPaperRootItemID,
  getPaperRootItemKey,
  isStandalonePaper,
} from "../../../domain/conversation";
import {
  ZoteroCollectionRepository,
  type SourceUniverseCollectionOption,
} from "./ZoteroCollectionRepository";
import { ZoteroLibraryItemRepository } from "./ZoteroLibraryItemRepository";
import { createPaperSourceRefWithZotero, dedupeSources } from "./items";
import { getZoteroGlobal } from "../environment";

type SourceUniverseSnapshot = {
  workspace: WorkspaceIdentity;
  sources: PaperSourceRef[];
  collections: SourceUniverseCollectionOption[];
  libraryItemCount: number;
};

class ZoteroSourceCatalog {
  private readonly collections: ZoteroCollectionRepository;
  private readonly libraryItems: ZoteroLibraryItemRepository;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.collections = new ZoteroCollectionRepository(this.zotero);
    this.libraryItems = new ZoteroLibraryItemRepository(this.zotero);
  }

  async getSnapshot(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }): Promise<SourceUniverseSnapshot> {
    const [collections, libraryItemIDs] = await Promise.all([
      this.collections.listOptions(input.workspace.libraryID),
      this.libraryItems.listViewItemIDs(input.workspace.libraryID),
    ]);
    const sources =
      input.workspace.workspaceType === "library"
        ? await this.sourcesFromItems(
            await this.libraryItems.getItems(libraryItemIDs),
            input.currentSource,
          )
        : await this.resolveSources(input.workspace, input.currentSource);
    return {
      workspace: input.workspace,
      sources,
      collections,
      libraryItemCount: libraryItemIDs.length,
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
      await this.libraryItems.listViewItems(workspace.libraryID),
      currentSource,
    );
  }

  private async resolvePaper(
    paper: PaperIdentity,
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef | null> {
    const parent = this.zotero.Items.get(
      getPaperRootItemID(paper) || getPaperRootItemKey(paper),
    );
    if (!parent) return null;
    const source = createPaperSourceRefWithZotero(
      parent,
      currentSource,
      this.zotero,
    );
    return source && (await this.isAvailableStandaloneSource(parent, source))
      ? source
      : null;
  }

  private async sourcesFromItems(
    items: Zotero.Item[],
    currentSource?: PaperIdentity,
  ): Promise<PaperSourceRef[]> {
    const sources = (
      await Promise.all(
        items.map(async (item) => {
          const source = createPaperSourceRefWithZotero(
            item,
            currentSource,
            this.zotero,
          );
          return source &&
            (await this.isAvailableStandaloneSource(item, source))
            ? source
            : null;
        }),
      )
    ).filter((item): item is PaperSourceRef => Boolean(item));
    return dedupeSources(sources).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }

  private async isAvailableStandaloneSource(
    item: Zotero.Item,
    source: PaperSourceRef,
  ): Promise<boolean> {
    if (!isStandalonePaper(source)) return true;
    try {
      const path = await (
        item as Zotero.Item & {
          getFilePathAsync?: () => Promise<string | false | null | undefined>;
        }
      ).getFilePathAsync?.();
      return typeof path === "string" && Boolean(path);
    } catch {
      return false;
    }
  }
}

export { ZoteroSourceCatalog };
export type { SourceUniverseSnapshot };
