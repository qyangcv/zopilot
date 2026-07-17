import type { Conversation } from "../../../domain/conversation";
import type {
  ItemContextTree,
  LocalAttachmentRef,
  NoteContextRef,
  PaperSourceRef,
  SourceMention,
  WorkspaceType,
} from "../../../domain/conversation";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import type { ProviderBrand } from "../../../domain/agent/providerBrand";
import type { RunningTurnSnapshot } from "../../../domain/agent/streaming";

export type SidebarMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mentions?: SourceMention[];
  noteContexts?: NoteContextRef[];
  localAttachments?: LocalAttachmentRef[];
  status?: "complete" | "error" | "interrupted";
  completedAt?: string;
  responseDuration?: string;
  model?: string;
  providerBrand?: ProviderBrand;
  transient?: boolean;
  trace?: AgentTraceItem[];
};

export type SidebarModelView = {
  slug: string;
  displayName: string;
  providerProfileId: string;
  providerLabel: string;
  providerBrand?: ProviderBrand;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type SidebarContextView = {
  label: string;
  hostContextKind?: "reader" | "library";
  workspaceKey?: string;
  workspaceType?: WorkspaceType;
  collectionKey?: string;
  itemKey?: string;
  paperTitle?: string;
  paperKey?: string;
  parentItemKey?: string;
  attachmentKey?: string;
};

export type SidebarCollectionOption = {
  key: string;
  label: string;
  path: string[];
  level: number;
  parentKey?: string;
  hasChildren: boolean;
  itemCount: number;
};

type SidebarSessionView = {
  id: string;
  title: string;
  meta: string;
  active: boolean;
  conversation: Conversation;
};

export type SidebarSessionMode = "history" | "archive";

export type SidebarPromptView = {
  id: string;
  title: string;
  body: string;
  scope: "workspace" | "global";
  updatedAt: string;
  custom?: boolean;
};

export type SidebarState = {
  conversationId?: string;
  title: string;
  context: SidebarContextView;
  messages: SidebarMessageView[];
  sessions: SidebarSessionView[];
  sessionsOpen: boolean;
  sessionsMode: SidebarSessionMode;
  composerEnabled: boolean;
  busy: boolean;
  models: SidebarModelView[];
  selectedProviderId: string;
  selectedModel: string;
  selectedReasoningEffort?: string;
  availableReasoningEfforts: string[];
  backendStatus: "idle" | "connected" | "disconnected";
  backendDiagnosticMessage?: string;
  activeProviderLabel?: string;
  focusToken: number;
  sourceCandidates: PaperSourceRef[];
  itemContextTree?: ItemContextTree;
  activeNoteContexts: NoteContextRef[];
  libraryItemCount: number;
  collectionOptions: SidebarCollectionOption[];
  prompts: SidebarPromptView[];
};

export type SidebarStreamingSnapshot = RunningTurnSnapshot;

export type SidebarPromptSubmission = {
  text: string;
  mentions: SourceMention[];
  noteContexts?: NoteContextRef[];
  persistNoteContexts?: boolean;
  localAttachments: LocalAttachmentRef[];
};

export type SidebarActions = {
  archiveSession: (conversation: Conversation) => void;
  close: () => void;
  createNewSession: () => void;
  getItemContextTree: (
    source: SourceMention,
  ) => Promise<ItemContextTree | undefined>;
  hideSessions: () => void;
  openExternalLink: (url: string) => void;
  selectModel: (model: string) => void;
  selectModelEffort: (model: string, effort: string) => void;
  selectWorkspaceMode: (type: WorkspaceType) => void;
  selectCollectionWorkspace: (collectionKey: string) => void;
  selectItemWorkspace: (sourceId: string) => void;
  updateActiveNoteContexts: (noteContexts: NoteContextRef[]) => void;
  submitPrompt: (submission: SidebarPromptSubmission) => void;
  uploadAttachment: () => Promise<LocalAttachmentRef[]>;
  interruptActiveTurn: () => void;
  restoreSession: (conversation: Conversation) => void;
  switchSession: (conversation: Conversation) => void;
  toggleArchivedSessions: () => void;
  toggleSessions: () => void;
};
