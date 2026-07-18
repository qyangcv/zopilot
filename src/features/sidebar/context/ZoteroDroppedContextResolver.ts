import { getString } from "../../../app/localization";
import type {
  LocalAttachmentRef,
  NoteContextRef,
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { getZoteroGlobal } from "../../../integrations/zotero/environment";
import type { SidebarDropPayload } from "../../../integrations/zotero/compat/dragData";
import { ZoteroCollectionRepository } from "../../../integrations/zotero/sources/ZoteroCollectionRepository";
import {
  createPaperSourceRefForAttachmentWithZotero,
  createPaperSourceRefWithZotero,
} from "../../../integrations/zotero/sources/items";
import { loadZoteroItem } from "../../../integrations/zotero/sources/ZoteroItemLookup";
import { createLogger } from "../../../runtime/logging/logger";
import { createLocalAttachmentRef } from "./attachmentUpload";

type DroppedContextCandidate =
  | { kind: "source"; source: PaperSourceRef }
  | { kind: "note"; note: NoteContextRef }
  | { kind: "local-attachment"; attachment: LocalAttachmentRef };

type ZoteroDroppedItem = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  dateModified?: string;
  deleted?: boolean;
  parentItemID?: number | false;
  parentItemKey?: string | false;
  getAttachments?: (includeTrashed?: boolean) => number[];
  getFilePathAsync?: () => Promise<string | false | null | undefined>;
  getField?: (field: string) => string;
  getNoteTitle?: () => string;
  isAnnotation?: () => boolean;
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

type WorkspaceMembership = {
  itemIDs: ReadonlySet<number>;
  itemKeys: ReadonlySet<string>;
};

const logger = createLogger("sidebar.dropResolver");

class ZoteroDroppedContextResolver {
  private readonly collections: ZoteroCollectionRepository;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.collections = new ZoteroCollectionRepository(zotero);
  }

  async resolve(input: {
    payload: SidebarDropPayload;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }): Promise<DroppedContextCandidate[]> {
    if (input.payload.kind === "local-files") {
      return input.payload.paths
        .map(createLocalAttachmentRef)
        .filter(
          (attachment): attachment is LocalAttachmentRef => attachment !== null,
        )
        .map((attachment) => ({ kind: "local-attachment", attachment }));
    }

    let membership: WorkspaceMembership | undefined;
    let items: ZoteroDroppedItem[];
    try {
      [membership, items] = await Promise.all([
        this.getWorkspaceMembership(input.workspace),
        this.loadItems(input.payload.itemIDs),
      ]);
    } catch (error) {
      logger.error("failed to load dropped Zotero items", error, {
        workspaceKey: input.workspace.workspaceKey,
      });
      return [];
    }
    const resolved = await Promise.all(
      items.map(async (item) => {
        try {
          return await this.resolveItem(
            item,
            input.workspace,
            membership,
            input.currentSource,
          );
        } catch (error) {
          logger.warn("failed to resolve dropped Zotero item", {
            error,
            itemID: item.id,
            workspaceKey: input.workspace.workspaceKey,
          });
          return undefined;
        }
      }),
    );
    return resolved.filter((candidate): candidate is DroppedContextCandidate =>
      Boolean(candidate),
    );
  }

  private async resolveItem(
    item: ZoteroDroppedItem,
    workspace: WorkspaceIdentity,
    membership: WorkspaceMembership | undefined,
    currentSource?: PaperIdentity,
  ): Promise<DroppedContextCandidate | undefined> {
    if (
      item.deleted ||
      item.isAnnotation?.() ||
      item.libraryID !== workspace.libraryID
    ) {
      return undefined;
    }
    if (item.isRegularItem?.()) {
      if (!this.isInWorkspace(item, undefined, workspace, membership)) {
        return undefined;
      }
      const attachmentIDs = item.getAttachments?.(false) || [];
      if (attachmentIDs.length) {
        await this.zotero.Items.getAsync(attachmentIDs);
      }
      const source = createPaperSourceRefWithZotero(
        item,
        currentSource,
        this.zotero,
      );
      if (!source) return undefined;
      const attachment = await loadZoteroItem<ZoteroDroppedItem>(this.zotero, {
        libraryID: source.libraryID,
        itemID: source.attachmentItemID,
      });
      return attachment &&
        !attachment.deleted &&
        attachment.isPDFAttachment?.() &&
        (await getAvailableFilePath(attachment))
        ? { kind: "source", source }
        : undefined;
    }
    if (item.isAttachment?.()) {
      return this.resolveAttachment(item, workspace, membership);
    }
    if (item.isNote?.()) {
      return this.resolveNote(item, workspace, membership);
    }
    return undefined;
  }

  private async resolveAttachment(
    attachment: ZoteroDroppedItem,
    workspace: WorkspaceIdentity,
    membership: WorkspaceMembership | undefined,
  ): Promise<DroppedContextCandidate | undefined> {
    const parent = await this.loadParent(attachment);
    if (
      !this.isInWorkspace(attachment, parent, workspace, membership) ||
      (parent && (parent.deleted || !parent.isRegularItem?.()))
    ) {
      return undefined;
    }
    const path = await getAvailableFilePath(attachment);
    if (!path) return undefined;

    if (attachment.isPDFAttachment?.()) {
      if (parent) {
        const source = createPaperSourceRefForAttachmentWithZotero(
          parent,
          attachment,
          this.zotero,
        );
        return source ? { kind: "source", source } : undefined;
      }
      const local = createLocalAttachmentRef(path);
      return local?.kind === "pdf"
        ? { kind: "local-attachment", attachment: local }
        : undefined;
    }

    const local = createLocalAttachmentRef(path);
    return local?.kind === "image"
      ? { kind: "local-attachment", attachment: local }
      : undefined;
  }

  private async resolveNote(
    note: ZoteroDroppedItem,
    workspace: WorkspaceIdentity,
    membership: WorkspaceMembership | undefined,
  ): Promise<DroppedContextCandidate | undefined> {
    const parent = await this.loadParent(note);
    if (
      !this.isInWorkspace(note, parent, workspace, membership) ||
      (parent && (parent.deleted || !parent.isRegularItem?.()))
    ) {
      return undefined;
    }
    return {
      kind: "note",
      note: {
        id: `note:${note.libraryID}:${note.key}`,
        libraryID: note.libraryID,
        parentItemID: parent?.id,
        parentItemKey: parent?.key,
        noteItemID: note.id,
        noteItemKey: note.key,
        title:
          note.getNoteTitle?.() ||
          note.getField?.("title") ||
          getString("sidebar-untitled-note"),
        dateModified: note.dateModified || "",
      },
    };
  }

  private isInWorkspace(
    item: ZoteroDroppedItem,
    parent: ZoteroDroppedItem | undefined,
    workspace: WorkspaceIdentity,
    membership: WorkspaceMembership | undefined,
  ): boolean {
    if (workspace.workspaceType === "library") {
      return item.libraryID === workspace.libraryID;
    }
    if (workspace.workspaceType === "item") {
      return Boolean(
        workspace.itemKey &&
        (parent
          ? parent.key === workspace.itemKey
          : item.key === workspace.itemKey),
      );
    }
    const target = parent || item;
    return Boolean(
      membership?.itemIDs.has(target.id) ||
      membership?.itemKeys.has(target.key),
    );
  }

  private async loadParent(
    item: ZoteroDroppedItem,
  ): Promise<ZoteroDroppedItem | undefined> {
    if (!item.parentItemID && !item.parentItemKey) return undefined;
    return loadZoteroItem<ZoteroDroppedItem>(this.zotero, {
      libraryID: item.libraryID,
      itemID: item.parentItemID,
      itemKey: item.parentItemKey,
    });
  }

  private async loadItems(itemIDs: number[]): Promise<ZoteroDroppedItem[]> {
    if (!itemIDs.length) return [];
    const loaded = await this.zotero.Items.getAsync(itemIDs);
    const items = (Array.isArray(loaded) ? loaded : [loaded]).filter(
      (item): item is Zotero.Item => Boolean(item),
    ) as ZoteroDroppedItem[];
    const byID = new Map(items.map((item) => [item.id, item]));
    return itemIDs
      .map((itemID) => byID.get(itemID))
      .filter((item): item is ZoteroDroppedItem => Boolean(item));
  }

  private async getWorkspaceMembership(
    workspace: WorkspaceIdentity,
  ): Promise<WorkspaceMembership | undefined> {
    if (workspace.workspaceType !== "collection" || !workspace.collectionKey) {
      return undefined;
    }
    const items = (await this.collections.listItems(
      workspace.libraryID,
      workspace.collectionKey,
    )) as ZoteroDroppedItem[];
    return {
      itemIDs: new Set(items.map((item) => item.id)),
      itemKeys: new Set(items.map((item) => item.key)),
    };
  }
}

async function getAvailableFilePath(
  item: ZoteroDroppedItem,
): Promise<string | undefined> {
  try {
    const path = await item.getFilePathAsync?.();
    return typeof path === "string" && path ? path : undefined;
  } catch {
    return undefined;
  }
}

export { ZoteroDroppedContextResolver };
export type { DroppedContextCandidate };
