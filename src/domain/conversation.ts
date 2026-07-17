import type { AgentTraceItem } from "./agent/trace";
import type { ProviderBrand } from "./agent/providerBrand";

type ConversationMessageStatus = "complete" | "error" | "interrupted";
type ConversationMessageRole = "user" | "assistant";
type WorkspaceType = "item" | "collection" | "library";

type PaperIdentity = {
  paperKey: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey: string;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
};

type PaperSourceRef = PaperIdentity & {
  sourceId: string;
  creators?: string[];
  year?: string;
  collectionKeys?: string[];
};

type SourceMention = {
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

type NoteContextRef = {
  id: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey: string;
  noteItemID: number;
  noteItemKey: string;
  title: string;
  dateModified: string;
};

type ResolvedNoteContext = {
  reference: NoteContextRef;
  content: string;
};

type ItemContextDisabledReason = "unsupported-type" | "file-unavailable";

type ItemContextPdfNode = {
  id: string;
  kind: "pdf";
  title: string;
  current: boolean;
  selectable: boolean;
  disabledReason?: ItemContextDisabledReason;
  source: PaperSourceRef;
};

type ItemContextNoteNode = {
  id: string;
  kind: "note";
  title: string;
  selectable: true;
  invalidReason?: "unavailable";
  note: NoteContextRef;
};

type ItemContextUnsupportedAttachmentNode = {
  id: string;
  kind: "unsupported-attachment";
  title: string;
  selectable: false;
  disabledReason: "unsupported-type";
  attachmentItemID: number;
  attachmentKey: string;
  contentType?: string;
};

type ItemContextNode =
  | ItemContextPdfNode
  | ItemContextNoteNode
  | ItemContextUnsupportedAttachmentNode;

type ItemContextTree = {
  root: {
    itemID?: number;
    itemKey: string;
    title: string;
  };
  nodes: ItemContextNode[];
};

type LocalAttachmentRef = {
  id: string;
  path: string;
  filename: string;
  kind: "pdf" | "image";
  mimeType?: string;
};

type WorkspaceIdentity = {
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

type ConversationMetadata = WorkspaceIdentity & {
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
  activeNoteContexts?: NoteContextRef[];
};

type ConversationMessage = {
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
  providerBrand?: ProviderBrand;
  backendRunId?: string;
  backendTurnId?: string;
  capabilitySnapshot?: Record<string, boolean>;
  status: ConversationMessageStatus;
  model?: string;
  reasoningEffort?: string;
  trace?: AgentTraceItem[];
  mentions?: SourceMention[];
  noteContexts?: NoteContextRef[];
  localAttachments?: LocalAttachmentRef[];
};

type Conversation = {
  metadata: ConversationMetadata;
  messages: ConversationMessage[];
};

function createItemWorkspaceIdentity(paper: PaperIdentity): WorkspaceIdentity {
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

function createLibraryWorkspaceIdentity(input: {
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

function createCollectionWorkspaceIdentity(input: {
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

export {
  createCollectionWorkspaceIdentity,
  createItemWorkspaceIdentity,
  createLibraryWorkspaceIdentity,
};
export type {
  Conversation,
  ConversationMessage,
  ConversationMessageRole,
  ConversationMessageStatus,
  ConversationMetadata,
  LocalAttachmentRef,
  ItemContextDisabledReason,
  ItemContextNode,
  ItemContextPdfNode,
  ItemContextNoteNode,
  ItemContextTree,
  ItemContextUnsupportedAttachmentNode,
  NoteContextRef,
  PaperIdentity,
  PaperSourceRef,
  ResolvedNoteContext,
  SourceMention,
  WorkspaceIdentity,
  WorkspaceType,
};
