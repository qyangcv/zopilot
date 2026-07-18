import type {
  SourceMention,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { ZoteroCollectionRepository } from "./ZoteroCollectionRepository";

type ZoteroRegularItem = Zotero.Item & {
  key: string;
  libraryID: number;
  deleted?: boolean;
  isRegularItem?: () => boolean;
};

class ZoteroWorkspaceParentScope {
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

  async resolveSelectedParentKeys(
    workspace: WorkspaceIdentity,
    mentions: SourceMention[],
  ): Promise<ReadonlySet<string>> {
    const allowedParentKeys = await this.resolveAllowedParentKeys(workspace);
    if (workspace.workspaceType === "item") {
      return allowedParentKeys || new Set();
    }
    const selectedParentKeys = new Set(
      mentions
        .filter((mention) => mention.libraryID === workspace.libraryID)
        .map((mention) => mention.parentItemKey),
    );
    if (!allowedParentKeys) {
      return selectedParentKeys;
    }
    return new Set(
      [...selectedParentKeys].filter((key) => allowedParentKeys.has(key)),
    );
  }
}

export { ZoteroWorkspaceParentScope };
