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

type SidebarHostContext =
  | {
      kind: "reader";
      tabID?: string;
      itemID?: number;
    }
  | {
      kind: "library";
      rowID: string;
    };

type SidebarDisplayState =
  | { kind: "closed"; token: number }
  | { kind: "no-reader"; token: number; label: string }
  | {
      kind: "loading";
      token: number;
      hostContext?: SidebarHostContext;
      reader?: _ZoteroTypes.ReaderInstance<"pdf">;
      label: string;
    }
  | {
      kind: "ready";
      token: number;
      hostContext?: SidebarHostContext;
      reader?: _ZoteroTypes.ReaderInstance<"pdf">;
      workspace: WorkspaceIdentity;
      currentSource?: PaperIdentity;
      conversation: Conversation;
    }
  | {
      kind: "error";
      token: number;
      hostContext?: SidebarHostContext;
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
    hostContext?: SidebarHostContext;
    reader?: _ZoteroTypes.ReaderInstance<"pdf">;
    workspace: WorkspaceIdentity;
    currentSource?: PaperIdentity | null;
  }) => Promise<void>;
};

function shouldLoadReaderItemContextTree(
  hostContext: SidebarHostContext | undefined,
  workspaceType: WorkspaceType,
): boolean {
  return hostContext?.kind === "reader" && workspaceType === "item";
}

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
      hostContext: {
        kind: "reader",
        tabID: reader.tabID,
        itemID: reader.itemID,
      },
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
        hostContext: {
          kind: "reader",
          tabID: reader.tabID,
          itemID: reader.itemID,
        },
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
        hostContext: {
          kind: "reader",
          tabID: reader.tabID,
          itemID: reader.itemID,
        },
        reader,
        label: workspace.workspaceLabel,
        message: this.options.formatError(error),
      });
    }
  }

  async loadWorkspaceConversation(input: {
    token: number;
    hostContext?: SidebarHostContext;
    reader?: _ZoteroTypes.ReaderInstance<"pdf">;
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
      hostContext: input.hostContext,
      reader: input.reader,
      workspace: input.workspace,
      currentSource: input.currentSource || input.workspace.defaultSource,
      conversation,
    });
    this.options.updateViewState({
      sourceCandidates: [],
      itemContextTree: undefined,
    });

    try {
      const currentSource =
        input.currentSource || input.workspace.defaultSource;
      const [snapshot, itemContextTree] = await Promise.all([
        this.options.getSourceUniverse().getSnapshot({
          workspace: input.workspace,
          currentSource,
        }),
        shouldLoadReaderItemContextTree(
          input.hostContext,
          input.workspace.workspaceType,
        )
          ? this.options.getSourceUniverse().getItemContextTree({
              workspace: input.workspace,
              currentSource,
            })
          : Promise.resolve(undefined),
      ]);
      if (!this.options.canCommitSelection(input.token)) {
        return;
      }
      this.options.setDisplayState({
        kind: "ready",
        token: input.token,
        hostContext: input.hostContext,
        reader: input.reader,
        workspace: snapshot.workspace,
        currentSource: input.currentSource || input.workspace.defaultSource,
        conversation,
      });
      this.options.updateViewState({
        sourceCandidates: snapshot.sources,
        itemContextTree,
        libraryItemCount: snapshot.libraryItemCount,
        collectionOptions: snapshot.collections,
      });
    } catch (error) {
      logger.warn("failed to refresh workspace source universe", {
        error,
        workspaceKey: input.workspace.workspaceKey,
      });
      if (this.options.canCommitSelection(input.token)) {
        this.options.updateViewState({
          sourceCandidates: [],
          itemContextTree: undefined,
        });
      }
    }
  }

  async selectWorkspaceMode(type: WorkspaceType): Promise<void> {
    const ready = this.options.getReadyDisplayState();
    if (!ready || ready.workspace.workspaceType === type) {
      return;
    }
    const token = this.options.nextSelectionToken();
    const currentSource = ready.currentSource || ready.workspace.defaultSource;
    let workspace: WorkspaceIdentity | null = null;
    if (type === "library") {
      workspace = await this.options
        .getSourceUniverse()
        .createLibraryWorkspace({
          libraryID: ready.workspace.libraryID,
        });
    } else if (type === "collection") {
      const collectionKey =
        this.options.getViewState().collectionOptions[0]?.key ||
        ready.workspace.collectionKey;
      workspace = collectionKey
        ? await this.options.getSourceUniverse().createCollectionWorkspace({
            libraryID: ready.workspace.libraryID,
            collectionKey,
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
        hostContext: ready.hostContext,
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
      });
    if (workspace) {
      await this.options.activateWorkspace({
        token,
        hostContext: ready.hostContext,
        reader: ready.reader,
        workspace,
        currentSource: ready.currentSource || ready.workspace.defaultSource,
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
      hostContext: ready.hostContext,
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

export { shouldLoadReaderItemContextTree, WorkspaceCoordinator };
export type {
  ReadyDisplayState,
  SidebarHostContext,
  SidebarDisplayState,
  WorkspaceCoordinatorOptions,
};
