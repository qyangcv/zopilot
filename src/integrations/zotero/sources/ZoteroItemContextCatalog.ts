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
  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {}

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
