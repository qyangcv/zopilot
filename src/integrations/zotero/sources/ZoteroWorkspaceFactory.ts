import type {
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import {
  createCollectionWorkspaceIdentity,
  createItemWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
} from "../../../domain/conversation";
import { getLibraryLabel, getZoteroGlobal } from "../environment";
import { ZoteroCollectionRepository } from "./ZoteroCollectionRepository";
import { paperSourceRefToIdentity } from "./items";

class ZoteroWorkspaceFactory {
  private readonly collections: ZoteroCollectionRepository;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.collections = new ZoteroCollectionRepository(this.zotero);
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
    return collection
      ? createCollectionWorkspaceIdentity({
          libraryID: input.libraryID,
          collectionKey: input.collectionKey,
          label: collection.label,
          path: collection.path,
          defaultSource: input.currentSource,
        })
      : null;
  }

  async createItemWorkspace(
    source: PaperSourceRef,
  ): Promise<WorkspaceIdentity> {
    return createItemWorkspaceIdentity(paperSourceRefToIdentity(source));
  }
}

export { ZoteroWorkspaceFactory };
