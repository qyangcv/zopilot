import type {
  ItemContextNode,
  ItemContextTree,
  NoteContextRef,
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { parseSourceId } from "../../../domain/sourceIdentity";
import { getString } from "../../../app/localization";
import { getZoteroGlobal } from "../environment";
import { createPaperSourceRefForAttachmentWithZotero } from "./items";
import { loadCachedZoteroItem, loadZoteroItem } from "./ZoteroItemLookup";
import { ZoteroWorkspaceParentScope } from "./ZoteroWorkspaceParentScope";

type ZoteroContextItem = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  dateModified: string;
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
  private readonly parentScope: ZoteroWorkspaceParentScope;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.parentScope = new ZoteroWorkspaceParentScope(zotero);
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

  async resolveSelectedPdfSources(
    workspace: WorkspaceIdentity,
    sourceIds: string[],
  ): Promise<PaperSourceRef[]> {
    if (!sourceIds.length) {
      return [];
    }
    const allowedParentKeys =
      await this.parentScope.resolveAllowedParentKeys(workspace);
    const parentCache = new Map<
      string,
      Promise<ZoteroContextItem | undefined>
    >();
    const sources = await Promise.all(
      sourceIds.map(async (sourceId) => {
        const attachmentKey = parseSourceId(sourceId, workspace.libraryID);
        if (!attachmentKey) return undefined;
        const attachment = await loadZoteroItem<ZoteroContextItem>(
          this.zotero,
          {
            libraryID: workspace.libraryID,
            itemKey: attachmentKey,
          },
        );
        if (
          !attachment ||
          attachment.deleted ||
          !attachment.isAttachment?.() ||
          !attachment.isPDFAttachment?.()
        ) {
          return undefined;
        }
        const parent = await loadCachedZoteroItem<ZoteroContextItem>(
          parentCache,
          this.zotero,
          {
            libraryID: attachment.libraryID,
            itemID: attachment.parentItemID,
            itemKey: attachment.parentItemKey,
          },
        );
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
    const parent = await loadZoteroItem<ZoteroContextItem>(this.zotero, {
      libraryID: workspace.libraryID,
      itemID: workspace.defaultSource?.parentItemID,
      itemKey: workspace.itemKey,
    });
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
