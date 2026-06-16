import type { ConversationMetadata } from "../shared/conversation";
import type { PaperScope } from "../zotero/types";

export {
  PAPER_BINDING_MISSING_MESSAGE,
  createPaperBindingHeaders,
  parsePaperBindingHeaders,
};
export type { BoundPaperScope };

const PAPER_BINDING_MISSING_MESSAGE =
  "This Codex thread is not bound to a Zotero paper.";

const PAPER_BINDING_HEADERS = {
  conversationId: "X-Zopilot-Conversation-ID",
  paperKey: "X-Zopilot-Paper-Key",
  attachmentItemID: "X-Zopilot-Attachment-Item-ID",
  attachmentKey: "X-Zopilot-Attachment-Key",
  libraryID: "X-Zopilot-Library-ID",
} as const;

type BoundPaperScope = PaperScope & {
  conversationId: string;
  paperKey: string;
};

function createPaperBindingHeaders(
  conversation: ConversationMetadata,
): Record<string, string> {
  return {
    [PAPER_BINDING_HEADERS.conversationId]: conversation.id,
    [PAPER_BINDING_HEADERS.paperKey]: conversation.paperKey,
    [PAPER_BINDING_HEADERS.attachmentItemID]: String(
      conversation.attachmentItemID,
    ),
    [PAPER_BINDING_HEADERS.attachmentKey]: conversation.attachmentKey,
    [PAPER_BINDING_HEADERS.libraryID]: String(conversation.libraryID),
  };
}

function parsePaperBindingHeaders(
  headers: Record<string, string>,
): { ok: true; value: BoundPaperScope } | { ok: false; error: string } {
  const conversationId = readHeader(
    headers,
    PAPER_BINDING_HEADERS.conversationId,
  );
  const paperKey = readHeader(headers, PAPER_BINDING_HEADERS.paperKey);
  const rawAttachmentItemID = readHeader(
    headers,
    PAPER_BINDING_HEADERS.attachmentItemID,
  );
  const attachmentKey = readHeader(
    headers,
    PAPER_BINDING_HEADERS.attachmentKey,
  );
  const rawLibraryID = readHeader(headers, PAPER_BINDING_HEADERS.libraryID);

  if (
    !conversationId ||
    !paperKey ||
    !rawAttachmentItemID ||
    !attachmentKey ||
    !rawLibraryID
  ) {
    return {
      ok: false,
      error: PAPER_BINDING_MISSING_MESSAGE,
    };
  }

  const attachmentItemID = parseIntegerHeader(
    PAPER_BINDING_HEADERS.attachmentItemID,
    rawAttachmentItemID,
  );
  const libraryID = parseIntegerHeader(
    PAPER_BINDING_HEADERS.libraryID,
    rawLibraryID,
  );
  if (!attachmentItemID.ok) {
    return attachmentItemID;
  }
  if (!libraryID.ok) {
    return libraryID;
  }

  return {
    ok: true,
    value: {
      conversationId,
      paperKey,
      attachmentItemID: attachmentItemID.value,
      attachmentKey,
      libraryID: libraryID.value,
    },
  };
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
