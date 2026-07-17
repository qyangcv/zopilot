import type {
  ItemContextNode,
  ItemContextTree,
  NoteContextRef,
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { getString } from "../../../app/localization";
import { getZoteroGlobal } from "../environment";
import { ZoteroCollectionRepository } from "./ZoteroCollectionRepository";
import { createPaperSourceRefForAttachmentWithZotero } from "./items";

type ZoteroContextItem = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  dateModified: string;
  attachmentContentType?: string;
  attachmentFilename?: string;
  deleted?: boolean;
  parentItemID?: number | false;
  parentItemKey?: string | false;
  getAttachments?: (includeTrashed?: boolean) => number[];
  getFilePathAsync?: () => Promise<string | false | null | undefined>;
  getField?: (field: string) => string;
  getNoteTitle?: () => string;
  getNotes?: (includeTrashed?: boolean) => number[];
  isAttachment?: () => boolean;
  isNote?: () => boolean;
  isPDFAttachment?: () => boolean;
  isRegularItem?: () => boolean;
};

class ZoteroItemContextCatalog {
  private readonly collections: ZoteroCollectionRepository;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.collections = new ZoteroCollectionRepository(zotero);
  }

  async getTree(input: {
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity;
  }): Promise<ItemContextTree | undefined> {
    const parent = await this.resolveParent(input.workspace);
    if (!parent) {
      return undefined;
    }

    const [attachments, notes] = await Promise.all([
      this.listAttachments(parent),
      this.listNotes(parent),
    ]);
    const currentAttachmentKey =
      input.currentSource?.attachmentKey ||
      input.workspace.defaultSource?.attachmentKey;
    const orderedAttachments = [
      ...attachments.filter((item) => item.key === currentAttachmentKey),
      ...attachments.filter((item) => item.key !== currentAttachmentKey),
    ];
    const attachmentNodes = await Promise.all(
      orderedAttachments.map((attachment) =>
        this.createAttachmentNode(
          parent,
          attachment,
          attachment.key === currentAttachmentKey,
        ),
      ),
    );
    const noteNodes = notes.map((note) => this.createNoteNode(parent, note));

    return {
      root: {
        itemID: parent.id,
        itemKey: parent.key,
        title: parent.getField?.("title") || parent.key,
      },
      nodes: [...attachmentNodes, ...noteNodes],
    };
  }

  async resolvePdfSources(
    workspace: WorkspaceIdentity,
  ): Promise<PaperSourceRef[]> {
    const parent = await this.resolveParent(workspace);
    if (!parent) {
      return [];
    }
    return (await this.listAttachments(parent))
      .map((attachment) =>
        createPaperSourceRefForAttachmentWithZotero(
          parent,
          attachment,
          this.zotero,
        ),
      )
      .filter((source): source is PaperSourceRef => Boolean(source));
  }

  async resolveSelectedPdfSources(
    workspace: WorkspaceIdentity,
    sourceIds: string[],
  ): Promise<PaperSourceRef[]> {
    const allowedParentKeys = await this.resolveAllowedParentKeys(workspace);
    const sources = await Promise.all(
      sourceIds.map(async (sourceId) => {
        const prefix = `${workspace.libraryID}-`;
        if (!sourceId.startsWith(prefix)) return undefined;
        const attachmentKey = sourceId.slice(prefix.length);
        if (!attachmentKey) return undefined;
        let attachment: ZoteroContextItem | false | undefined;
        try {
          attachment = (await this.zotero.Items.getByLibraryAndKeyAsync(
            workspace.libraryID,
            attachmentKey,
          )) as ZoteroContextItem | false;
        } catch {
          attachment = undefined;
        }
        if (
          !attachment ||
          attachment.deleted ||
          !attachment.isAttachment?.() ||
          !attachment.isPDFAttachment?.()
        ) {
          return undefined;
        }
        const parent = await this.resolveAttachmentParent(attachment);
        if (
          !parent ||
          !parent.isRegularItem?.() ||
          parent.deleted ||
          parent.libraryID !== workspace.libraryID ||
          (allowedParentKeys && !allowedParentKeys.has(parent.key))
        ) {
          return undefined;
        }
        const source = createPaperSourceRefForAttachmentWithZotero(
          parent,
          attachment,
          this.zotero,
        );
        return source?.sourceId === sourceId ? source : undefined;
      }),
    );
    return sources.filter((source): source is PaperSourceRef =>
      Boolean(source),
    );
  }

  private async resolveParent(
    workspace: WorkspaceIdentity,
  ): Promise<ZoteroContextItem | undefined> {
    if (workspace.workspaceType !== "item" || !workspace.itemKey) {
      return undefined;
    }
    let parent: ZoteroContextItem | false | undefined;
    try {
      parent = workspace.defaultSource?.parentItemID
        ? ((await this.zotero.Items.getAsync(
            workspace.defaultSource.parentItemID,
          )) as ZoteroContextItem)
        : ((await this.zotero.Items.getByLibraryAndKeyAsync(
            workspace.libraryID,
            workspace.itemKey,
          )) as ZoteroContextItem | false);
    } catch {
      parent = undefined;
    }
    if (!parent) {
      return undefined;
    }
    return parent.isRegularItem?.() &&
      parent.libraryID === workspace.libraryID &&
      parent.key === workspace.itemKey
      ? parent
      : undefined;
  }

  private async resolveAttachmentParent(
    attachment: ZoteroContextItem,
  ): Promise<ZoteroContextItem | undefined> {
    let parent: ZoteroContextItem | false | undefined;
    try {
      parent = attachment.parentItemID
        ? ((await this.zotero.Items.getAsync(
            attachment.parentItemID,
          )) as ZoteroContextItem)
        : attachment.parentItemKey
          ? ((await this.zotero.Items.getByLibraryAndKeyAsync(
              attachment.libraryID,
              attachment.parentItemKey,
            )) as ZoteroContextItem | false)
          : undefined;
    } catch {
      parent = undefined;
    }
    return parent || undefined;
  }

  private async resolveAllowedParentKeys(
    workspace: WorkspaceIdentity,
  ): Promise<Set<string> | undefined> {
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
      (items as ZoteroContextItem[])
        .filter(
          (item) =>
            item.libraryID === workspace.libraryID &&
            !item.deleted &&
            item.isRegularItem?.(),
        )
        .map((item) => item.key),
    );
  }

  private async listAttachments(
    parent: ZoteroContextItem,
  ): Promise<ZoteroContextItem[]> {
    const ids = parent.getAttachments?.(false) || [];
    const items = await this.loadItems(ids);
    return items.filter((item) =>
      Boolean(item.isAttachment?.() && !item.deleted),
    );
  }

  private async listNotes(
    parent: ZoteroContextItem,
  ): Promise<ZoteroContextItem[]> {
    const ids = parent.getNotes?.(false) || [];
    const items = await this.loadItems(ids);
    return items.filter((item) => Boolean(item.isNote?.() && !item.deleted));
  }

  private async loadItems(ids: number[]): Promise<ZoteroContextItem[]> {
    if (!ids.length) {
      return [];
    }
    try {
      const items = await this.zotero.Items.getAsync(ids);
      return (Array.isArray(items) ? items : [items]).filter(
        (item): item is Zotero.Item => Boolean(item),
      ) as ZoteroContextItem[];
    } catch {
      return [];
    }
  }

  private async createAttachmentNode(
    parent: ZoteroContextItem,
    attachment: ZoteroContextItem,
    current: boolean,
  ): Promise<ItemContextNode> {
    const title =
      attachment.getField?.("title") ||
      attachment.attachmentFilename ||
      attachment.key;
    if (!attachment.isPDFAttachment?.()) {
      return {
        id: `attachment:${attachment.libraryID}:${attachment.key}`,
        kind: "unsupported-attachment",
        title,
        selectable: false,
        disabledReason: "unsupported-type",
        attachmentItemID: attachment.id,
        attachmentKey: attachment.key,
        contentType: attachment.attachmentContentType,
      };
    }

    const source = createPaperSourceRefForAttachmentWithZotero(
      parent,
      attachment,
      this.zotero,
    );
    if (!source) {
      throw new Error(`Failed to create PDF source: ${attachment.key}`);
    }
    let fileAvailable = false;
    try {
      fileAvailable = Boolean(await attachment.getFilePathAsync?.());
    } catch {
      fileAvailable = false;
    }
    return {
      id: source.sourceId,
      kind: "pdf",
      title,
      current,
      selectable: fileAvailable,
      disabledReason: fileAvailable ? undefined : "file-unavailable",
      source,
    };
  }

  private createNoteNode(
    parent: ZoteroContextItem,
    note: ZoteroContextItem,
  ): ItemContextNode {
    const reference: NoteContextRef = {
      id: `note:${note.libraryID}:${note.key}`,
      libraryID: note.libraryID,
      parentItemID: parent.id,
      parentItemKey: parent.key,
      noteItemID: note.id,
      noteItemKey: note.key,
      title: note.getNoteTitle?.() || getString("sidebar-untitled-note"),
      dateModified: note.dateModified || "",
    };
    return {
      id: reference.id,
      kind: "note",
      title: reference.title,
      selectable: true,
      note: reference,
    };
  }
}

export { ZoteroItemContextCatalog };
