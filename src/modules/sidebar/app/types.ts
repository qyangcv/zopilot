import type { Conversation } from "../../../shared/conversation";
import type {
  LocalAttachmentRef,
  PaperSourceRef,
  SourceMention,
  WorkspaceType,
} from "../../../shared/conversation";
import type { CodexDiagnosticCode } from "../../../codex/diagnostics";
import type { ReaderLocator } from "../readerNavigation";

export type SidebarMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  mentions?: SourceMention[];
  localAttachments?: LocalAttachmentRef[];
  status?: "complete" | "error" | "interrupted";
  completedAt?: string;
  transient?: boolean;
  running?: boolean;
  locators?: ReaderLocator[];
};

export type SidebarModelView = {
  slug: string;
  displayName: string;
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

export type SidebarCommandCategory =
  | "source"
  | "reader"
  | "attachment"
  | "prompt"
  | "session";

export type SidebarCommandView = {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  category: SidebarCommandCategory;
  icon: string;
  available: boolean;
  disabledReason?: string;
};

export type SidebarPromptView = {
  id: string;
  title: string;
  body: string;
  variables: string[];
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
  selectedModel: string;
  selectedReasoningEffort?: string;
  availableReasoningEfforts: string[];
  codexStatus: "checking" | "connected" | "disconnected";
  codexDiagnostic?: CodexDiagnosticCode;
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
  openReaderLocator: (locator: ReaderLocator) => void;
  selectModel: (model: string) => void;
  selectReasoningEffort: (effort: string) => void;
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
