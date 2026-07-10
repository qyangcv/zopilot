import type {
  Conversation,
  PaperIdentity,
  PaperSourceRef,
  WorkspaceIdentity,
  WorkspaceType,
} from "../../../domain/conversation";
import { createItemWorkspaceIdentity } from "../../../domain/conversation";
import { getConversationStore } from "../../../runtime/persistence/conversations/ConversationService";
import { getString } from "../../../app/localization";
import { createLogger } from "../../../runtime/logging/logger";
import { ZoteroContextGateway } from "../../../integrations/zotero/ZoteroContextGateway";
import { createPaperIdentity } from "../../../integrations/zotero/paperIdentity";
import {
  ZoteroSourceUniverse,
  paperSourceRefToIdentity,
} from "../../../integrations/zotero/ZoteroWorkspaceService";
import type { SidebarState } from "../ui/types";
import { getSelectedItemTitle } from "../host/selectedItem";

const logger = createLogger("sidebar.workspace");

type SidebarDisplayState =
  | { kind: "closed"; token: number }
  | { kind: "no-reader"; token: number; label: string }
  | {
      kind: "loading";
      token: number;
      reader: _ZoteroTypes.ReaderInstance<"pdf">;
      label: string;
    }
  | {
      kind: "ready";
      token: number;
      reader: _ZoteroTypes.ReaderInstance<"pdf">;
      workspace: WorkspaceIdentity;
      conversation: Conversation;
    }
  | {
      kind: "error";
      token: number;
      reader?: _ZoteroTypes.ReaderInstance<"pdf">;
      label: string;
      message: string;
    };

type ReadyDisplayState = Extract<SidebarDisplayState, { kind: "ready" }>;

type WorkspaceCoordinatorOptions = {
  win: Window;
  getSourceUniverse: () => ZoteroSourceUniverse;
  getViewState: () => SidebarState;
  getReadyDisplayState: () => ReadyDisplayState | undefined;
  nextSelectionToken: () => number;
  canCommitSelection: (token: number) => boolean;
  setDisplayState: (state: SidebarDisplayState) => void;
  updateViewState: (patch: Partial<SidebarState>) => void;
  formatError: (error: unknown) => string;
  activateWorkspace: (input: {
    token: number;
    reader: _ZoteroTypes.ReaderInstance<"pdf">;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity | null;
  }) => Promise<void>;
};

class WorkspaceCoordinator {
  constructor(private readonly options: WorkspaceCoordinatorOptions) {}

  async loadReaderConversation(
    reader: _ZoteroTypes.ReaderInstance<"pdf">,
    token: number,
  ): Promise<void> {
    if (!this.options.canCommitSelection(token)) {
      return;
    }

    this.options.setDisplayState({
      kind: "loading",
      token,
      reader,
      label: getSelectedItemTitle(this.options.win, reader),
    });

    const gateway = new ZoteroContextGateway(this.options.win);
    const scope = await gateway.getActivePaper(reader);
    if (!this.options.canCommitSelection(token)) {
      return;
    }
    const paper = scope ? createPaperIdentity(scope) : null;
    const workspace = paper ? createItemWorkspaceIdentity(paper) : null;
    if (!workspace) {
      this.options.setDisplayState({
        kind: "error",
        token,
        reader,
        label: getSelectedItemTitle(this.options.win, reader),
        message: getString("sidebar-unavailable-message"),
      });
      return;
    }

    try {
      await this.options.activateWorkspace({
        token,
        reader,
        workspace,
        currentSource: paper,
      });
    } catch (error) {
      if (!this.options.canCommitSelection(token)) {
        return;
      }
      logger.error("failed to load active conversation", error, {
        workspaceKey: workspace.workspaceKey,
        attachmentKey: workspace.defaultSource?.attachmentKey,
      });
      this.options.setDisplayState({
        kind: "error",
        token,
        reader,
        label: workspace.workspaceLabel,
        message: this.options.formatError(error),
      });
    }
  }

  async loadWorkspaceConversation(input: {
    token: number;
    reader: _ZoteroTypes.ReaderInstance<"pdf">;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity | null;
  }): Promise<void> {
    const conversation =
      await getConversationStore().getOrCreateLatestWorkspaceConversation(
        input.workspace,
      );
    if (!this.options.canCommitSelection(input.token)) {
      return;
    }
    this.options.setDisplayState({
      kind: "ready",
      token: input.token,
      reader: input.reader,
      workspace: input.workspace,
      conversation,
    });
    this.options.updateViewState({ sourceCandidates: [] });

    try {
      const snapshot = await this.options.getSourceUniverse().getSnapshot({
        workspace: input.workspace,
        currentSource: input.currentSource || input.workspace.defaultSource,
      });
      if (!this.options.canCommitSelection(input.token)) {
        return;
      }
      this.options.setDisplayState({
        kind: "ready",
        token: input.token,
        reader: input.reader,
        workspace: snapshot.workspace,
        conversation,
      });
      this.options.updateViewState({
        sourceCandidates: snapshot.sources,
        collectionOptions: snapshot.collections,
      });
    } catch (error) {
      logger.warn("failed to refresh workspace source universe", {
        error,
        workspaceKey: input.workspace.workspaceKey,
      });
      if (this.options.canCommitSelection(input.token)) {
        this.options.updateViewState({ sourceCandidates: [] });
      }
    }
  }

  async selectWorkspaceMode(type: WorkspaceType): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready || ready.workspace.workspaceType === type) {
      return;
    }
    const token = this.options.nextSelectionToken();
    const currentSource = ready.workspace.defaultSource;
    let workspace: WorkspaceIdentity | null = null;
    if (type === "library") {
      workspace = await this.options
        .getSourceUniverse()
        .createLibraryWorkspace({
          libraryID: ready.workspace.libraryID,
          currentSource,
        });
    } else if (type === "collection") {
      const collectionKey =
        this.options.getViewState().collectionOptions[0]?.key ||
        ready.workspace.collectionKey;
      workspace = collectionKey
        ? await this.options.getSourceUniverse().createCollectionWorkspace({
            libraryID: ready.workspace.libraryID,
            collectionKey,
            currentSource,
          })
        : null;
    } else {
      const source = this.findSourceForItemMode(currentSource);
      workspace = source
        ? await this.options.getSourceUniverse().createItemWorkspace(source)
        : currentSource
          ? createItemWorkspaceIdentity(currentSource)
          : null;
    }
    if (workspace) {
      await this.options.activateWorkspace({
        token,
        reader: ready.reader,
        workspace,
        currentSource,
      });
    }
  }

  async selectCollectionWorkspace(collectionKey: string): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (
      !ready ||
      (ready.workspace.workspaceType === "collection" &&
        ready.workspace.collectionKey === collectionKey)
    ) {
      return;
    }
    const token = this.options.nextSelectionToken();
    const workspace = await this.options
      .getSourceUniverse()
      .createCollectionWorkspace({
        libraryID: ready.workspace.libraryID,
        collectionKey,
        currentSource: ready.workspace.defaultSource,
      });
    if (workspace) {
      await this.options.activateWorkspace({
        token,
        reader: ready.reader,
        workspace,
        currentSource: ready.workspace.defaultSource,
      });
    }
  }

  async selectItemWorkspace(sourceId: string): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    const source = this.options
      .getViewState()
      .sourceCandidates.find((item) => item.sourceId === sourceId);
    if (!ready || !source) {
      return;
    }
    const token = this.options.nextSelectionToken();
    const workspace = await this.options
      .getSourceUniverse()
      .createItemWorkspace(source);
    await this.options.activateWorkspace({
      token,
      reader: ready.reader,
      workspace,
      currentSource: paperSourceRefToIdentity(source),
    });
  }

  private findSourceForItemMode(
    currentSource?: PaperIdentity,
  ): PaperSourceRef | undefined {
    const currentSourceId = currentSource
      ? `${currentSource.libraryID}-${currentSource.attachmentKey}`
      : "";
    const sources = this.options.getViewState().sourceCandidates;
    return (
      sources.find((source) => source.sourceId === currentSourceId) ||
      sources[0]
    );
  }
}

export { WorkspaceCoordinator };
export type {
  ReadyDisplayState,
  SidebarDisplayState,
  WorkspaceCoordinatorOptions,
};
