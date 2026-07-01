import type { ConversationMetadata } from "../shared/conversation";
import type { WorkspaceType } from "../shared/conversation";
import type { PaperScope } from "../zotero/types";

export {
  PAPER_BINDING_MISSING_MESSAGE,
  createPaperBindingHeaders,
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
  paperKey: "X-Zopilot-Paper-Key",
  attachmentItemID: "X-Zopilot-Attachment-Item-ID",
  attachmentKey: "X-Zopilot-Attachment-Key",
  libraryID: "X-Zopilot-Library-ID",
} as const;

type BoundWorkspaceScope = {
  conversationId: string;
  workspaceKey: string;
  workspaceType: WorkspaceType;
  workspaceLabel: string;
  defaultSource?: PaperScope & {
    paperKey: string;
  };
};

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
  const source = conversation.defaultSource;
  if (source) {
    headers[PAPER_BINDING_HEADERS.paperKey] = source.paperKey;
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

  return {
    ok: true,
    value: {
      conversationId,
      workspaceKey,
      workspaceType,
      workspaceLabel: workspaceLabel || workspaceKey,
      defaultSource: {
        paperKey,
        attachmentItemID: attachmentItemID.value,
        attachmentKey,
        libraryID: libraryID.value,
      },
    },
  };
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
