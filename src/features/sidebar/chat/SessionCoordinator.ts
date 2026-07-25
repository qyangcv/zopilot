import type {
  Conversation,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { getConversationStore } from "../../../runtime/persistence/conversations/ConversationService";
import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarSessionMode, SidebarState } from "../ui/types";
import { createSessionView } from "../state/viewModel";

export { SidebarSessionCoordinator };
export type { SidebarReadyDisplayState, SidebarSessionCoordinatorOptions };

type SidebarReadyDisplayState = {
  kind: "ready";
  token: number;
  reader?: _ZoteroTypes.ReaderInstance<"pdf">;
  workspace: WorkspaceIdentity;
  conversation: Conversation;
};

type SidebarSessionStore = {
  listWorkspaceConversations(workspaceKey: string): Promise<Conversation[]>;
  listArchivedWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]>;
  createWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation>;
  activateWorkspaceConversation(
    metadata: Conversation["metadata"],
  ): Promise<Conversation>;
  archiveWorkspaceConversation(
    metadata: Conversation["metadata"],
  ): Promise<void>;
  restoreWorkspaceConversation(
    metadata: Conversation["metadata"],
  ): Promise<Conversation["metadata"]>;
  getLatestWorkspaceConversation(
    workspaceKey: string,
  ): Promise<Conversation | null>;
};

type SidebarSessionCoordinatorOptions = {
  getReadyDisplayState: () => SidebarReadyDisplayState | undefined;
  getReadyStateForActiveContext: () => Promise<
    SidebarReadyDisplayState | undefined
  >;
  getViewState: () => SidebarState;
  updateViewState: (patch: Partial<SidebarState>) => void;
  setReadyConversation: (conversation: Conversation) => void;
  focusComposer: () => void;
  interruptConversationTurn: (conversationId: string) => void;
  isDestroyed: () => boolean;
  isOpen: () => boolean;
  store?: SidebarSessionStore;
};

const logger = createLogger("sidebar.sessions");

class SidebarSessionCoordinator {
  private navigationWorkspaceKey?: string;
  private navigationRefresh?: Promise<void>;

  constructor(private readonly options: SidebarSessionCoordinatorOptions) {}

  async togglePopover(mode: SidebarSessionMode = "history"): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    const viewState = this.options.getViewState();
    if (!ready) {
      return;
    }
    if (viewState.sessionsOpen && viewState.sessionsMode === mode) {
      this.hidePopover();
      return;
    }
    await this.showPopover(mode);
  }

  async showPopover(
    mode: SidebarSessionMode = this.options.getViewState().sessionsMode,
  ): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspaceKey = ready.workspace.workspaceKey;
    let conversations: Conversation[];
    try {
      conversations =
        mode === "archive"
          ? await this.store.listArchivedWorkspaceConversations(workspaceKey)
          : await this.store.listWorkspaceConversations(workspaceKey);
    } catch (error) {
      logger.error("failed to list workspace conversations", error, {
        workspaceKey,
        mode,
      });
      return;
    }
    if (!this.isStillCurrentWorkspace(workspaceKey)) {
      return;
    }
    const activeConversationId =
      this.options.getReadyDisplayState()?.conversation.metadata.id;
    const sessionViews = conversations.map((conversation) =>
      createSessionView(conversation, activeConversationId),
    );
    this.options.updateViewState({
      ...(mode === "archive"
        ? { archivedSessions: sessionViews }
        : { sessions: sessionViews }),
      sessionsOpen: true,
      sessionsMode: mode,
    });
  }

  hidePopover(): void {
    const viewState = this.options.getViewState();
    if (!viewState.sessionsOpen) return;
    this.options.updateViewState({ sessionsOpen: false });
  }

  ensureNavigationSessions(): void {
    const workspaceKey =
      this.options.getReadyDisplayState()?.workspace.workspaceKey;
    if (!workspaceKey || workspaceKey === this.navigationWorkspaceKey) {
      return;
    }
    if (this.navigationRefresh) {
      void this.navigationRefresh.then(() => this.ensureNavigationSessions());
      return;
    }
    void this.refreshNavigationSessions();
  }

  async refreshNavigationSessions(): Promise<void> {
    if (this.navigationRefresh) {
      await this.navigationRefresh;
    }
    const ready = this.options.getReadyDisplayState();
    if (!ready) return;
    const workspaceKey = ready.workspace.workspaceKey;
    const refresh = this.loadNavigationSessions(workspaceKey);
    this.navigationRefresh = refresh;
    try {
      await refresh;
    } finally {
      if (this.navigationRefresh === refresh) {
        this.navigationRefresh = undefined;
      }
    }
  }

  async createNewSession(): Promise<void> {
    const ready = await this.options.getReadyStateForActiveContext();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    let conversation: Conversation;
    try {
      conversation = await this.store.createWorkspaceConversation(workspace);
    } catch (error) {
      logger.error("failed to create workspace conversation", error, {
        workspaceKey: workspace.workspaceKey,
        attachmentKey: workspace.defaultSource?.attachmentKey,
      });
      return;
    }
    this.options.setReadyConversation(conversation);
    this.hidePopover();
    this.options.focusComposer();
    await this.refreshDetachedNavigation();
  }

  async switchSession(conversation: Conversation): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready) {
      return;
    }
    let active: Conversation;
    try {
      active = await this.store.activateWorkspaceConversation(
        conversation.metadata,
      );
    } catch (error) {
      logger.error("failed to switch workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (!this.isStillCurrentWorkspace(active.metadata.workspaceKey)) {
      return;
    }
    this.options.setReadyConversation(active);
    this.hidePopover();
    this.options.focusComposer();
    await this.refreshDetachedNavigation();
  }

  async archiveSession(conversation: Conversation): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    this.options.interruptConversationTurn(conversation.metadata.id);
    try {
      await this.store.archiveWorkspaceConversation(conversation.metadata);
    } catch (error) {
      logger.error("failed to archive workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (!this.isStillCurrentWorkspace(workspace.workspaceKey)) {
      return;
    }

    if (
      this.options.getReadyDisplayState()?.conversation.metadata.id ===
      conversation.metadata.id
    ) {
      let next: Conversation;
      try {
        next =
          (await this.store.getLatestWorkspaceConversation(
            workspace.workspaceKey,
          )) || (await this.store.createWorkspaceConversation(workspace));
      } catch (error) {
        logger.error("failed to select next workspace conversation", error, {
          archivedConversationId: conversation.metadata.id,
          workspaceKey: workspace.workspaceKey,
        });
        return;
      }
      this.options.setReadyConversation(next);
    }

    await this.refreshVisibleSessions();
  }

  async restoreSession(conversation: Conversation): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready) {
      return;
    }
    const workspace = ready.workspace;
    let restoredMetadata: Conversation["metadata"];
    try {
      restoredMetadata = await this.store.restoreWorkspaceConversation(
        conversation.metadata,
      );
    } catch (error) {
      logger.error("failed to restore workspace conversation", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      return;
    }
    if (!this.isStillCurrentWorkspace(workspace.workspaceKey)) {
      return;
    }

    const current = this.options.getReadyDisplayState();
    if (current?.conversation.metadata.id === conversation.metadata.id) {
      this.options.setReadyConversation({
        ...current.conversation,
        metadata: restoredMetadata,
      });
    }

    await this.refreshVisibleSessions();
  }

  private get store(): SidebarSessionStore {
    return this.options.store || getConversationStore();
  }

  private async loadNavigationSessions(workspaceKey: string): Promise<void> {
    let sessions: Conversation[];
    let archivedSessions: Conversation[];
    try {
      [sessions, archivedSessions] = await Promise.all([
        this.store.listWorkspaceConversations(workspaceKey),
        this.store.listArchivedWorkspaceConversations(workspaceKey),
      ]);
    } catch (error) {
      logger.error("failed to list detached window conversations", error, {
        workspaceKey,
      });
      return;
    }
    if (!this.isStillCurrentWorkspace(workspaceKey)) return;
    const activeConversationId =
      this.options.getReadyDisplayState()?.conversation.metadata.id;
    this.navigationWorkspaceKey = workspaceKey;
    this.options.updateViewState({
      sessions: sessions.map((conversation) =>
        createSessionView(conversation, activeConversationId),
      ),
      archivedSessions: archivedSessions.map((conversation) =>
        createSessionView(conversation, activeConversationId),
      ),
    });
  }

  private async refreshDetachedNavigation(): Promise<void> {
    if (!this.options.getViewState().detachedWindowOpen) return;
    await this.refreshNavigationSessions();
  }

  private async refreshVisibleSessions(): Promise<void> {
    const viewState = this.options.getViewState();
    if (viewState.detachedWindowOpen) {
      await this.refreshNavigationSessions();
      return;
    }
    if (viewState.sessionsOpen) {
      await this.showPopover(viewState.sessionsMode);
    }
  }

  private isStillCurrentWorkspace(workspaceKey: string): boolean {
    return (
      !this.options.isDestroyed() &&
      this.options.isOpen() &&
      this.options.getReadyDisplayState()?.workspace.workspaceKey ===
        workspaceKey
    );
  }
}
