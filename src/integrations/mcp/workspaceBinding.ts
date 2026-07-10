import type { ConversationMetadata } from "../../domain/conversation";
import type { WorkspaceType } from "../../domain/conversation";
import type { PaperScope } from "../zotero/types";

export {
  PAPER_BINDING_MISSING_MESSAGE,
  createPaperBindingHeaders,
  conversationToWorkspaceQueryScope,
  parsePaperBindingHeaders,
};
export type { BoundWorkspaceScope };

const PAPER_BINDING_MISSING_MESSAGE =
  "This Codex thread is not bound to a Zotero paper.";

const PAPER_BINDING_HEADERS = {
  conversationId: "X-Zopilot-Conversation-ID",
  workspaceKey: "X-Zopilot-Workspace-Key",
  workspaceType: "X-Zopilot-Workspace-Type",
  workspaceLabel: "X-Zopilot-Workspace-Label",
  collectionKey: "X-Zopilot-Collection-Key",
  collectionPath: "X-Zopilot-Collection-Path",
  itemKey: "X-Zopilot-Item-Key",
  paperKey: "X-Zopilot-Paper-Key",
  parentItemID: "X-Zopilot-Parent-Item-ID",
  parentItemKey: "X-Zopilot-Parent-Item-Key",
  paperTitle: "X-Zopilot-Paper-Title",
  attachmentItemID: "X-Zopilot-Attachment-Item-ID",
  attachmentKey: "X-Zopilot-Attachment-Key",
  libraryID: "X-Zopilot-Library-ID",
} as const;

type BoundWorkspaceScope = {
  conversationId: string;
  workspaceKey: string;
  workspaceType: WorkspaceType;
  workspaceLabel: string;
  libraryID: number;
  collectionKey?: string;
  collectionPath?: string[];
  itemKey?: string;
  defaultSource?: PaperScope & {
    paperKey: string;
    title?: string;
  };
};

function conversationToWorkspaceQueryScope(
  conversation: ConversationMetadata,
): BoundWorkspaceScope {
  return {
    conversationId: conversation.id,
    workspaceKey: conversation.workspaceKey,
    workspaceType: conversation.workspaceType,
    workspaceLabel: conversation.workspaceLabel,
    libraryID: conversation.libraryID,
    collectionKey: conversation.collectionKey,
    collectionPath: conversation.collectionPath,
    itemKey: conversation.itemKey,
    defaultSource: conversation.defaultSource
      ? {
          paperKey: conversation.defaultSource.paperKey,
          libraryID: conversation.defaultSource.libraryID,
          parentItemID: conversation.defaultSource.parentItemID,
          parentItemKey: conversation.defaultSource.parentItemKey,
          attachmentItemID: conversation.defaultSource.attachmentItemID,
          attachmentKey: conversation.defaultSource.attachmentKey,
          title: conversation.defaultSource.title,
        }
      : undefined,
  };
}

function createPaperBindingHeaders(
  conversation: ConversationMetadata,
): Record<string, string> {
  const headers: Record<string, string> = {
    [PAPER_BINDING_HEADERS.conversationId]: conversation.id,
    [PAPER_BINDING_HEADERS.workspaceKey]: conversation.workspaceKey,
    [PAPER_BINDING_HEADERS.workspaceType]: conversation.workspaceType,
    [PAPER_BINDING_HEADERS.workspaceLabel]: conversation.workspaceLabel,
    [PAPER_BINDING_HEADERS.libraryID]: String(conversation.libraryID),
  };
  if (conversation.collectionKey) {
    headers[PAPER_BINDING_HEADERS.collectionKey] = conversation.collectionKey;
  }
  if (conversation.collectionPath?.length) {
    headers[PAPER_BINDING_HEADERS.collectionPath] = JSON.stringify(
      conversation.collectionPath,
    );
  }
  if (conversation.itemKey) {
    headers[PAPER_BINDING_HEADERS.itemKey] = conversation.itemKey;
  }
  const source = conversation.defaultSource;
  if (source) {
    headers[PAPER_BINDING_HEADERS.paperKey] = source.paperKey;
    if (source.parentItemID !== undefined) {
      headers[PAPER_BINDING_HEADERS.parentItemID] = String(source.parentItemID);
    }
    headers[PAPER_BINDING_HEADERS.parentItemKey] = source.parentItemKey;
    headers[PAPER_BINDING_HEADERS.paperTitle] = source.title;
    headers[PAPER_BINDING_HEADERS.attachmentItemID] = String(
      source.attachmentItemID,
    );
    headers[PAPER_BINDING_HEADERS.attachmentKey] = source.attachmentKey;
  }
  return headers;
}

function parsePaperBindingHeaders(
  headers: Record<string, string>,
): { ok: true; value: BoundWorkspaceScope } | { ok: false; error: string } {
  const conversationId = readHeader(
    headers,
    PAPER_BINDING_HEADERS.conversationId,
  );
  const workspaceKey = readHeader(headers, PAPER_BINDING_HEADERS.workspaceKey);
  const workspaceType = readHeader(
    headers,
    PAPER_BINDING_HEADERS.workspaceType,
  );
  const workspaceLabel =
    readHeader(headers, PAPER_BINDING_HEADERS.workspaceLabel) || workspaceKey;
  const rawLibraryID = readHeader(headers, PAPER_BINDING_HEADERS.libraryID);
  const collectionKey = readHeader(
    headers,
    PAPER_BINDING_HEADERS.collectionKey,
  );
  const itemKey = readHeader(headers, PAPER_BINDING_HEADERS.itemKey);

  if (!conversationId || !workspaceKey || !workspaceType || !rawLibraryID) {
    return {
      ok: false,
      error: PAPER_BINDING_MISSING_MESSAGE,
    };
  }
  if (!isWorkspaceType(workspaceType)) {
    return {
      ok: false,
      error: `Invalid Zopilot workspace binding header: ${PAPER_BINDING_HEADERS.workspaceType}.`,
    };
  }
  const libraryID = parseIntegerHeader(
    PAPER_BINDING_HEADERS.libraryID,
    rawLibraryID,
  );
  if (!libraryID.ok) {
    return libraryID;
  }

  const paperKey = readHeader(headers, PAPER_BINDING_HEADERS.paperKey);
  const rawParentItemID = readHeader(
    headers,
    PAPER_BINDING_HEADERS.parentItemID,
  );
  const parentItemKey = readHeader(
    headers,
    PAPER_BINDING_HEADERS.parentItemKey,
  );
  const paperTitle = readHeader(headers, PAPER_BINDING_HEADERS.paperTitle);
  const rawAttachmentItemID = readHeader(
    headers,
    PAPER_BINDING_HEADERS.attachmentItemID,
  );
  const attachmentKey = readHeader(
    headers,
    PAPER_BINDING_HEADERS.attachmentKey,
  );

  if (!paperKey && !rawAttachmentItemID && !attachmentKey) {
    return {
      ok: true,
      value: {
        conversationId,
        workspaceKey,
        workspaceType,
        workspaceLabel: workspaceLabel || workspaceKey,
        libraryID: libraryID.value,
        collectionKey,
        collectionPath: parseCollectionPath(headers),
        itemKey,
      },
    };
  }

  if (!paperKey || !rawAttachmentItemID || !attachmentKey) {
    return {
      ok: false,
      error: "Incomplete Zopilot source binding headers.",
    };
  }
  const attachmentItemID = parseIntegerHeader(
    PAPER_BINDING_HEADERS.attachmentItemID,
    rawAttachmentItemID,
  );
  if (!attachmentItemID.ok) {
    return attachmentItemID;
  }
  const parentItemID = rawParentItemID
    ? parseIntegerHeader(PAPER_BINDING_HEADERS.parentItemID, rawParentItemID)
    : undefined;
  if (parentItemID && !parentItemID.ok) {
    return parentItemID;
  }

  return {
    ok: true,
    value: {
      conversationId,
      workspaceKey,
      workspaceType,
      workspaceLabel: workspaceLabel || workspaceKey,
      libraryID: libraryID.value,
      collectionKey,
      collectionPath: parseCollectionPath(headers),
      itemKey,
      defaultSource: {
        paperKey,
        parentItemID: parentItemID?.value,
        parentItemKey,
        attachmentItemID: attachmentItemID.value,
        attachmentKey,
        libraryID: libraryID.value,
        title: paperTitle,
      },
    },
  };
}

function parseCollectionPath(
  headers: Record<string, string>,
): string[] | undefined {
  const raw = readHeader(headers, PAPER_BINDING_HEADERS.collectionPath);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    ) {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function isWorkspaceType(value: string): value is WorkspaceType {
  return value === "item" || value === "collection" || value === "library";
}

function parseIntegerHeader(
  name: string,
  value: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      error: `Invalid Zopilot paper binding header: ${name}.`,
    };
  }
  return {
    ok: true,
    value: parsed,
  };
}

function readHeader(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const direct = headers[name];
  if (direct !== undefined) {
    return direct.trim() || undefined;
  }
  const foundKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  const value = foundKey ? headers[foundKey] : undefined;
  return value?.trim() || undefined;
}
