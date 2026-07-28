import type { WorkspaceIdentity } from "../../../domain/conversation";
import { ZoteroCollectionRepository } from "./ZoteroCollectionRepository";

type ZoteroRegularItem = Zotero.Item & {
  key: string;
  libraryID: number;
  deleted?: boolean;
  isRegularItem?: () => boolean;
};

class ZoteroWorkspaceItemScope {
  private readonly collections: ZoteroCollectionRepository;

  constructor(zotero: typeof Zotero) {
    this.collections = new ZoteroCollectionRepository(zotero);
  }

  async resolveAllowedParentKeys(
    workspace: WorkspaceIdentity,
  ): Promise<ReadonlySet<string> | undefined> {
    if (workspace.workspaceType === "library") {
      return undefined;
    }
    if (workspace.workspaceType === "item") {
      return workspace.itemKey ? new Set([workspace.itemKey]) : new Set();
    }
    if (!workspace.collectionKey) {
      return new Set();
    }
    const items = await this.collections.listItems(
      workspace.libraryID,
      workspace.collectionKey,
    );
    return new Set(
      (items as ZoteroRegularItem[])
        .filter(
          (item) =>
            item.libraryID === workspace.libraryID &&
            !item.deleted &&
            item.isRegularItem?.(),
        )
        .map((item) => item.key),
    );
  }

  async resolveAllowedItemKeys(
    workspace: WorkspaceIdentity,
  ): Promise<ReadonlySet<string> | undefined> {
    return this.resolveAllowedRootItemKeys(workspace);
  }

  async resolveAllowedRootItemKeys(
    workspace: WorkspaceIdentity,
  ): Promise<ReadonlySet<string> | undefined> {
    if (workspace.workspaceType === "library") {
      return undefined;
    }
    if (workspace.workspaceType === "item") {
      return workspace.itemKey ? new Set([workspace.itemKey]) : new Set();
    }
    if (!workspace.collectionKey) {
      return new Set();
    }
    const items = await this.collections.listItems(
      workspace.libraryID,
      workspace.collectionKey,
    );
    return new Set(
      (items as ZoteroRegularItem[])
        .filter(
          (item) =>
            item.libraryID === workspace.libraryID &&
            !item.deleted &&
            typeof item.key === "string",
        )
        .map((item) => item.key),
    );
  }
}

export { ZoteroWorkspaceItemScope };
