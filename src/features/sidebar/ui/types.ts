import type { Conversation } from "../../../domain/conversation";
import type {
  LocalAttachmentRef,
  PaperSourceRef,
  SourceMention,
  WorkspaceType,
} from "../../../domain/conversation";
import type { AgentTraceItem } from "../../../domain/agent/trace";
import type { ProviderBrand } from "../../../domain/agent/providerBrand";

export type SidebarMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mentions?: SourceMention[];
  localAttachments?: LocalAttachmentRef[];
  status?: "complete" | "error" | "interrupted";
  completedAt?: string;
  responseDuration?: string;
  model?: string;
  providerBrand?: ProviderBrand;
  transient?: boolean;
  running?: boolean;
  trace?: AgentTraceItem[];
  finalStarted?: boolean;
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
  backendStatus: "checking" | "connected" | "disconnected";
  backendDiagnosticMessage?: string;
  activeProviderLabel?: string;
  focusToken: number;
  sourceCandidates: PaperSourceRef[];
  collectionOptions: SidebarCollectionOption[];
  prompts: SidebarPromptView[];
};

export type SidebarPromptSubmission = {
  text: string;
  mentions: SourceMention[];
  localAttachments: LocalAttachmentRef[];
};

export type SidebarActions = {
  archiveSession: (conversation: Conversation) => void;
  close: () => void;
  createNewSession: () => void;
  hideSessions: () => void;
  openExternalLink: (url: string) => void;
  selectModel: (model: string) => void;
  selectModelEffort: (model: string, effort: string) => void;
  selectWorkspaceMode: (type: WorkspaceType) => void;
  selectCollectionWorkspace: (collectionKey: string) => void;
  selectItemWorkspace: (sourceId: string) => void;
  submitPrompt: (submission: SidebarPromptSubmission) => void;
  uploadAttachment: () => Promise<LocalAttachmentRef | undefined>;
  interruptActiveTurn: () => void;
  restoreSession: (conversation: Conversation) => void;
  switchSession: (conversation: Conversation) => void;
  toggleArchivedSessions: () => void;
  toggleSessions: () => void;
};
