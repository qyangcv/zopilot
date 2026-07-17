import { getString } from "../../../app/localization";
import {
  isLibraryTab,
  resolveSelectedWorkspace,
} from "../../../integrations/zotero/selectedWorkspace";
import type { SidebarDisplayState } from "../workspace/WorkspaceCoordinator";
import { WorkspaceCoordinator } from "../workspace/WorkspaceCoordinator";
import { SidebarSurface } from "./SidebarSurface";

type ReadyDisplayState = Extract<SidebarDisplayState, { kind: "ready" }>;

type LibrarySelectionOptions = {
  win: Window;
  surface: SidebarSurface;
  workspaceCoordinator: WorkspaceCoordinator;
  isOpen: () => boolean;
  nextToken: () => number;
  getToken: () => number;
  canCommit: (token: number) => boolean;
  getDisplayState: () => SidebarDisplayState;
  getReadyDisplayState: () => ReadyDisplayState | undefined;
  setDisplayState: (state: SidebarDisplayState) => void;
  setClosedDisplayState: (token: number) => void;
  setOpen: (open: boolean) => void;
  renderDisplayState: () => void;
};

class LibrarySelectionCoordinator {
  constructor(private readonly options: LibrarySelectionOptions) {}

  openPane(): void {
    const token = this.options.nextToken();
    this.options.surface.attachLibrary();
    this.options.setOpen(true);
    void this.loadSelectedWorkspace(token);
  }

  refreshContext(): void {
    if (this.options.isOpen() && isLibraryTab(this.options.win)) {
      void this.syncWithSelectedWorkspace();
      return;
    }
    if (!this.options.isOpen()) {
      this.options.setClosedDisplayState(this.options.getToken());
      this.options.renderDisplayState();
    }
  }

  async getReadyStateForSelectedWorkspace(): Promise<
    ReadyDisplayState | undefined
  > {
    if (!isLibraryTab(this.options.win)) return undefined;
    const token = this.options.nextToken();
    const selected = resolveSelectedWorkspace(this.options.win);
    if (!this.options.canCommit(token)) return undefined;
    const ready = this.options.getReadyDisplayState();
    if (
      selected.status === "ready" &&
      ready?.hostContext?.kind === "library" &&
      ready.hostContext.rowID === selected.rowID &&
      ready.workspace.workspaceKey === selected.workspace.workspaceKey
    ) {
      return ready;
    }
    await this.loadResolvedWorkspace(selected, token);
    return this.options.getReadyDisplayState();
  }

  async syncWithSelectedWorkspace(): Promise<void> {
    if (!isLibraryTab(this.options.win)) return;
    if (!this.options.isOpen()) {
      const token = this.options.nextToken();
      this.options.setClosedDisplayState(token);
      this.options.renderDisplayState();
      return;
    }
    this.options.surface.attachLibrary();
    const token = this.options.nextToken();
    const selected = resolveSelectedWorkspace(this.options.win);
    if (!this.options.canCommit(token)) return;
    const ready = this.options.getReadyDisplayState();
    if (
      selected.status === "ready" &&
      ready?.hostContext?.kind === "library" &&
      ready.hostContext.rowID === selected.rowID &&
      ready.workspace.workspaceKey === selected.workspace.workspaceKey
    ) {
      return;
    }
    await this.loadResolvedWorkspace(selected, token);
  }

  private async loadSelectedWorkspace(token: number): Promise<void> {
    const selected = resolveSelectedWorkspace(this.options.win);
    await this.loadResolvedWorkspace(selected, token);
  }

  private async loadResolvedWorkspace(
    selected: ReturnType<typeof resolveSelectedWorkspace>,
    token: number,
  ): Promise<void> {
    if (!this.options.canCommit(token)) return;
    if (selected.status !== "ready") {
      this.options.setDisplayState({
        kind: "error",
        token,
        hostContext: selected.rowID
          ? { kind: "library", rowID: selected.rowID }
          : undefined,
        label: selected.label,
        message: getString("sidebar-unavailable-message"),
      });
      return;
    }

    this.options.setDisplayState({
      kind: "loading",
      token,
      hostContext: { kind: "library", rowID: selected.rowID },
      label: selected.label,
    });
    await this.options.workspaceCoordinator.loadWorkspaceConversation({
      token,
      hostContext: { kind: "library", rowID: selected.rowID },
      workspace: selected.workspace,
    });
  }
}

export { LibrarySelectionCoordinator };
