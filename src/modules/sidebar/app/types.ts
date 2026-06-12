import type { Conversation } from "../../../shared/conversation";

export type SidebarMessageView = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: "complete" | "error";
  transient?: boolean;
};

export type SidebarContextView = {
  label: string;
  paperTitle?: string;
  paperKey?: string;
  parentItemKey?: string;
  attachmentKey?: string;
};

export type SidebarSessionView = {
  id: string;
  title: string;
  meta: string;
  active: boolean;
  conversation: Conversation;
};

export type SidebarState = {
  title: string;
  context: SidebarContextView;
  messages: SidebarMessageView[];
  sessions: SidebarSessionView[];
  sessionsOpen: boolean;
  composerEnabled: boolean;
  busy: boolean;
  focusToken: number;
};

export type SidebarActions = {
  archiveSession: (conversation: Conversation) => void;
  close: () => void;
  createNewSession: () => void;
  hideSessions: () => void;
  openExternalLink: (url: string) => void;
  startResize: (event: PointerEvent) => void;
  submitPrompt: (text: string) => void;
  switchSession: (conversation: Conversation) => void;
  toggleSessions: () => void;
};
