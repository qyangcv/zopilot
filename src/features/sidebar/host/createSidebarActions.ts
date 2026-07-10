import type { WorkspaceType } from "../../../domain/conversation";
import type { SidebarActions, SidebarPromptSubmission } from "../ui/types";

type SidebarActionHandlers = {
  archiveSession: SidebarActions["archiveSession"];
  close: () => void;
  createNewSession: () => void;
  hideSessions: () => void;
  interruptActiveTurn: () => void;
  openExternalLink: (url: string) => void;
  openReaderLocator: SidebarActions["openReaderLocator"];
  restoreSession: SidebarActions["restoreSession"];
  selectCollectionWorkspace: (collectionKey: string) => void;
  selectItemWorkspace: (sourceId: string) => void;
  selectModel: (model: string) => void;
  selectReasoningEffort: (effort: string) => void;
  selectWorkspaceMode: (type: WorkspaceType) => void;
  submitPrompt: (submission: SidebarPromptSubmission) => void;
  switchSession: SidebarActions["switchSession"];
  toggleArchivedSessions: () => void;
  toggleSessions: () => void;
  uploadAttachment: SidebarActions["uploadAttachment"];
};

function createSidebarActions(handlers: SidebarActionHandlers): SidebarActions {
  return {
    archiveSession: (conversation) => handlers.archiveSession(conversation),
    close: handlers.close,
    createNewSession: handlers.createNewSession,
    hideSessions: handlers.hideSessions,
    interruptActiveTurn: handlers.interruptActiveTurn,
    openExternalLink: handlers.openExternalLink,
    openReaderLocator: (locator) => handlers.openReaderLocator(locator),
    selectModel: handlers.selectModel,
    selectReasoningEffort: handlers.selectReasoningEffort,
    selectWorkspaceMode: handlers.selectWorkspaceMode,
    selectCollectionWorkspace: handlers.selectCollectionWorkspace,
    selectItemWorkspace: handlers.selectItemWorkspace,
    submitPrompt: handlers.submitPrompt,
    uploadAttachment: handlers.uploadAttachment,
    switchSession: (conversation) => handlers.switchSession(conversation),
    restoreSession: (conversation) => handlers.restoreSession(conversation),
    toggleArchivedSessions: handlers.toggleArchivedSessions,
    toggleSessions: handlers.toggleSessions,
  };
}

export { createSidebarActions };
export type { SidebarActionHandlers };
