import type { AgentTraceItem } from "./agent/trace";
import type { ProviderBrand } from "./agent/providerBrand";

type ConversationMessageStatus = "complete" | "error" | "interrupted";
type ConversationMessageRole = "user" | "assistant";
type WorkspaceType = "item" | "collection" | "library";

type PaperIdentity = {
  paperKey: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey?: string;
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
  parentItemKey?: string;
  attachmentItemID: number;
  attachmentKey: string;
  title: string;
  availability?: "available" | "unavailable";
};

type ThreadSource = Omit<SourceMention, "id">;

type NoteContextRef = {
  id: string;
  libraryID: number;
  parentItemID?: number;
  parentItemKey?: string;
  noteItemID: number;
  noteItemKey: string;
  title: string;
  dateModified: string;
};

type ResolvedNoteContext = {
  reference: NoteContextRef;
  content: string;
};

type ItemContextPdfNode = {
  id: string;
  kind: "pdf";
  title: string;
  current: boolean;
  selectable: boolean;
  disabledReason?: "file-unavailable";
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
  revision: number;
  activeSources: ThreadSource[];
  primarySourceId?: string;
  latestPreview?: string;
  archived?: boolean;
  migration?:
    | {
        kind: "standalone-pdf-merge";
        status: "prepared" | "complete";
        sourceWorkspaceKey: string;
        sourceConversationIds: string[];
        targetConversationId?: string;
      }
    | {
        kind: "standalone-pdf-backup";
        sourceWorkspaceKey: string;
        sourceConversationId: string;
      };
};

type ConversationMessage = {
  id: string;
  conversationId: string;
  role: ConversationMessageRole;
  text: string;
  createdAt: string;
  completedAt?: string;
  backendId?: string;
  backendKind?: "codex-cli" | "openai-compatible";
  providerProfileId?: string;
  providerBrand?: ProviderBrand;
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
    itemKey: getPaperRootItemKey(paper),
    defaultSource: paper,
  };
}

function getPaperRootItemID(paper: PaperIdentity): number {
  return paper.parentItemID ?? paper.attachmentItemID;
}

function getPaperRootItemKey(paper: PaperIdentity): string {
  return paper.parentItemKey || paper.attachmentKey;
}

function isStandalonePaper(paper: PaperIdentity): boolean {
  return paper.parentItemID === undefined && paper.parentItemKey === undefined;
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
  getPaperRootItemID,
  getPaperRootItemKey,
  isStandalonePaper,
};
export type {
  Conversation,
  ConversationMessage,
  ConversationMessageRole,
  ConversationMessageStatus,
  ConversationMetadata,
  LocalAttachmentRef,
  ItemContextNode,
  ItemContextTree,
  NoteContextRef,
  PaperIdentity,
  PaperSourceRef,
  ResolvedNoteContext,
  SourceMention,
  ThreadSource,
  WorkspaceIdentity,
  WorkspaceType,
};
