import { assert } from "chai";
import { LibrarySelectionCoordinator } from "../../../src/features/sidebar/host/LibrarySelectionCoordinator.ts";

describe("library workspace selection coordinator", function () {
  it("does not let a slower previous collection selection replace the latest one", async function () {
    let selectedKey = "A";
    let releaseA: () => void = () => undefined;
    const waitForA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let token = 0;
    const loaded: string[] = [];
    const win = {
      Zotero_Tabs: { selectedID: "zotero-pane", selectedType: "library" },
      ZoteroPane: {
        getCollectionTreeRow: () => createCollectionRow(selectedKey),
      },
    } as unknown as Window;
    const coordinator = new LibrarySelectionCoordinator({
      win,
      surface: {
        attachLibrary: () => undefined,
        refreshToolbar: () => undefined,
      } as never,
      workspaceCoordinator: {
        async loadWorkspaceConversation(input: {
          token: number;
          workspace: { workspaceKey: string };
        }) {
          if (input.workspace.workspaceKey.endsWith(":A")) await waitForA;
          if (input.token === token) loaded.push(input.workspace.workspaceKey);
        },
      } as never,
      isOpen: () => true,
      nextToken: () => ++token,
      getToken: () => token,
      canCommit: (candidate) => candidate === token,
      getDisplayState: () => ({ kind: "closed", token: 0 }),
      getReadyDisplayState: () => undefined,
      setDisplayState: (state) => {
        if (state.kind === "loading") loaded.push(`loading:${state.label}`);
      },
      setClosedDisplayState: () => undefined,
      setOpen: () => undefined,
      renderDisplayState: () => undefined,
    });

    const first = coordinator.syncWithSelectedWorkspace();
    assert.deepEqual(loaded, ["loading:A"]);
    selectedKey = "B";
    const second = coordinator.syncWithSelectedWorkspace();
    await second;
    releaseA();
    await first;

    assert.deepEqual(loaded, ["loading:A", "loading:B", "collection:1:B"]);
  });
});

function createCollectionRow(key: string) {
  return {
    id: `C-${key}`,
    ref: { key, libraryID: 1 },
    getName: () => key,
    isCollection: () => true,
    isLibrary: () => false,
    isGroup: () => false,
  };
}
