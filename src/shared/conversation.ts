import type { PaperScope } from "../zotero/types";

export type ConversationMessageRole = "user" | "assistant";
export type ConversationMessageStatus = "complete" | "error" | "interrupted";

export type PaperIdentity = {
  paperKey: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey: string;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
};

export type ConversationMetadata = PaperIdentity & {
  id: string;
  scope: "paper";
  label: string;
  createdAt: string;
  updatedAt: string;
  codexThreadId?: string;
  codexSessionId?: string;
  latestPreview?: string;
  archived?: boolean;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  completedAt?: string;
  codexThreadId?: string;
  codexTurnId?: string;
  status: ConversationMessageStatus;
  model?: string;
  reasoningEffort?: string;
};

export type Conversation = {
  metadata: ConversationMetadata;
  messages: ConversationMessage[];
};

export function createPaperIdentity(scope: PaperScope): PaperIdentity | null {
  const parentItem = scope.parentItemID
    ? Zotero.Items.get(scope.parentItemID)
    : undefined;
  const parentItemKey = parentItem?.key || scope.parentItemKey;
  if (!parentItemKey) {
    return null;
  }

  const title =
    parentItem?.getField?.("title") ||
    Zotero.Items.get(scope.attachmentItemID)?.getField?.("title") ||
    parentItemKey;

  return {
    paperKey: `${scope.libraryID}:${parentItemKey}`,
    libraryID: scope.libraryID,
    parentItemID: scope.parentItemID,
    parentItemKey,
    attachmentItemID: scope.attachmentItemID,
    attachmentKey: scope.attachmentKey,
    title,
  };
}
