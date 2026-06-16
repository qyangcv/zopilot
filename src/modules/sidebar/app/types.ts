import type { Conversation } from "../../../shared/conversation";

export type SidebarMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "complete" | "error" | "interrupted";
  completedAt?: string;
  transient?: boolean;
  running?: boolean;
};

export type SidebarModelView = {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type SidebarContextView = {
  label: string;
  paperTitle?: string;
  paperKey?: string;
  parentItemKey?: string;
  attachmentKey?: string;
};

type SidebarSessionView = {
  id: string;
  title: string;
  meta: string;
  active: boolean;
  conversation: Conversation;
};

export type SidebarSessionMode = "history" | "archive";

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
  focusToken: number;
};

export type SidebarActions = {
  archiveSession: (conversation: Conversation) => void;
  close: () => void;
  createNewSession: () => void;
  hideSessions: () => void;
  openExternalLink: (url: string) => void;
  selectModel: (model: string) => void;
  selectReasoningEffort: (effort: string) => void;
  startResize: (event: PointerEvent) => void;
  submitPrompt: (text: string) => void;
  interruptActiveTurn: () => void;
  switchSession: (conversation: Conversation) => void;
  toggleArchivedSessions: () => void;
  toggleSessions: () => void;
};
