import type { PaperScope } from "../zotero/types";

type ConversationMessageStatus = "complete" | "error" | "interrupted";
type ConversationMessageRole = "user" | "assistant";
export type WorkspaceType = "item" | "collection" | "library";

export type PaperIdentity = {
  paperKey: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey: string;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
};

export type PaperSourceRef = PaperIdentity & {
  sourceId: string;
  creators?: string[];
  year?: string;
  collectionKeys?: string[];
};

export type SourceMention = {
  id: string;
  sourceId: string;
  paperKey: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey: string;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
};

export type LocalAttachmentRef = {
  id: string;
  path: string;
  filename: string;
  kind: "pdf" | "image";
  mimeType?: string;
};

export type WorkspaceIdentity = {
  workspaceKey: string;
  workspaceType: WorkspaceType;
  libraryID: number;
  workspaceLabel: string;
  workspaceTitle: string;
  collectionKey?: string;
  collectionPath?: string[];
  itemKey?: string;
  defaultSource?: PaperIdentity;
};

export type ConversationMetadata = WorkspaceIdentity & {
  id: string;
  scope: "workspace";
  label: string;
  createdAt: string;
  updatedAt: string;
  codexThreadId?: string;
  backendId?: string;
  providerProfileId?: string;
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
  backendId?: string;
  backendKind?: "codex-cli" | "openai-compatible";
  providerProfileId?: string;
  backendRunId?: string;
  backendTurnId?: string;
  capabilitySnapshot?: Record<string, boolean>;
  status: ConversationMessageStatus;
  model?: string;
  reasoningEffort?: string;
  mentions?: SourceMention[];
  localAttachments?: LocalAttachmentRef[];
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

export function createItemWorkspaceIdentity(
  paper: PaperIdentity,
): WorkspaceIdentity {
  return {
    workspaceKey: `item:${paper.paperKey}`,
    workspaceType: "item",
    libraryID: paper.libraryID,
    workspaceLabel: paper.title,
    workspaceTitle: paper.title,
    itemKey: paper.parentItemKey,
    defaultSource: paper,
  };
}

export function createLibraryWorkspaceIdentity(input: {
  libraryID: number;
  label?: string;
}): WorkspaceIdentity {
  const title = input.label || `Library ${input.libraryID}`;
  return {
    workspaceKey: `library:${input.libraryID}`,
    workspaceType: "library",
    libraryID: input.libraryID,
    workspaceLabel: title,
    workspaceTitle: title,
  };
}

export function createCollectionWorkspaceIdentity(input: {
  libraryID: number;
  collectionKey: string;
  label: string;
  path?: string[];
  defaultSource?: PaperIdentity;
}): WorkspaceIdentity {
  return {
    workspaceKey: `collection:${input.libraryID}:${input.collectionKey}`,
    workspaceType: "collection",
    libraryID: input.libraryID,
    workspaceLabel: input.label,
    workspaceTitle: input.label,
    collectionKey: input.collectionKey,
    collectionPath: input.path,
    defaultSource: input.defaultSource,
  };
}
