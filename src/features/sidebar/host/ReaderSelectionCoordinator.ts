import type { SidebarDisplayState } from "../workspace/WorkspaceCoordinator";
import { WorkspaceCoordinator } from "../workspace/WorkspaceCoordinator";
import {
  getSelectedPDFReader,
  getSelectedPDFReaderAsync,
  isPDFReader,
} from "../../../integrations/zotero/reader";
import { getSelectedItemTitle } from "./selectedItem";
import { SidebarSurface } from "./SidebarSurface";

type ReadyDisplayState = Extract<SidebarDisplayState, { kind: "ready" }>;

type ReaderSelectionOptions = {
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

class ReaderSelectionCoordinator {
  constructor(private readonly options: ReaderSelectionOptions) {}

  refreshContext(reader?: _ZoteroTypes.ReaderInstance): void {
    if (this.options.isOpen()) {
      if (isPDFReader(reader)) {
        void this.loadReaderConversation(reader, this.options.nextToken());
      } else {
        void this.syncWithSelectedPDFReader();
      }
      return;
    }
    this.options.setClosedDisplayState(this.options.getToken());
    this.options.renderDisplayState();
  }

  openPane(reader?: _ZoteroTypes.ReaderInstance): void {
    const token = this.options.nextToken();
    this.options.surface.attach(reader);
    this.options.setOpen(true);
    if (isPDFReader(reader)) {
      void this.loadReaderConversation(reader, token);
      return;
    }
    const selectedReader = getSelectedPDFReader(this.options.win);
    if (selectedReader) {
      this.options.surface.attach(selectedReader);
      void this.loadReaderConversation(selectedReader, token);
      return;
    }
    this.options.setDisplayState({
      kind: "no-reader",
      token,
      label: getSelectedItemTitle(this.options.win),
    });
    void this.loadSelectedReader(token);
  }

  async loadSelectedReader(token: number): Promise<void> {
    const reader = await getSelectedPDFReaderAsync(this.options.win);
    if (!this.options.canCommit(token)) return;
    if (!reader) {
      this.options.setOpen(false);
      return;
    }
    await this.loadReaderConversation(reader, token);
  }

  async loadReaderConversation(
    reader: _ZoteroTypes.ReaderInstance<"pdf">,
    token: number,
  ): Promise<void> {
    this.options.surface.attach(reader);
    await this.options.workspaceCoordinator.loadReaderConversation(
      reader,
      token,
    );
  }

  async getReadyStateForSelectedReader(): Promise<
    ReadyDisplayState | undefined
  > {
    const selectedReader = getSelectedPDFReader(this.options.win);
    const ready = this.options.getReadyDisplayState();
    if (selectedReader && ready && this.isCurrentReader(selectedReader)) {
      return ready;
    }
    const token = this.options.nextToken();
    if (selectedReader) {
      await this.loadReaderConversation(selectedReader, token);
      return this.options.getReadyDisplayState();
    }
    await this.loadSelectedReader(token);
    return this.options.getReadyDisplayState();
  }

  async syncWithSelectedPDFReader(): Promise<void> {
    const selectedReader = getSelectedPDFReader(this.options.win);
    if (!selectedReader) {
      const token = this.options.nextToken();
      if (this.options.isOpen()) {
        await this.loadSelectedReader(token);
      } else {
        this.options.setDisplayState({
          kind: "no-reader",
          token,
          label: getSelectedItemTitle(this.options.win),
        });
        this.options.surface.refreshToolbar();
      }
      return;
    }
    if (this.options.isOpen()) {
      if (
        this.isCurrentReader(selectedReader) &&
        this.options.getDisplayState().kind === "ready"
      ) {
        this.options.surface.refreshToolbar();
        return;
      }
      await this.loadReaderConversation(
        selectedReader,
        this.options.nextToken(),
      );
    } else {
      const token = this.options.nextToken();
      this.options.setClosedDisplayState(token);
      this.options.renderDisplayState();
    }
    this.options.surface.refreshToolbar();
  }

  private isCurrentReader(reader: _ZoteroTypes.ReaderInstance): boolean {
    const state = this.options.getDisplayState();
    if (
      (state.kind === "loading" ||
        state.kind === "ready" ||
        state.kind === "error") &&
      state.reader?.itemID === reader.itemID
    ) {
      return true;
    }
    return (
      state.kind === "ready" &&
      reader.itemID !== undefined &&
      Zotero.Items.get(reader.itemID)?.key ===
        state.workspace.defaultSource?.attachmentKey
    );
  }
}

export { ReaderSelectionCoordinator };
export type { ReaderSelectionOptions, ReadyDisplayState };
