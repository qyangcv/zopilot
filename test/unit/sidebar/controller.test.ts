import { assert } from "chai";
import { __sidebarControllerTestHooks } from "../../../src/features/sidebar/host/SidebarHostController.ts";
import { createItemWorkspaceIdentity } from "../../../src/domain/conversation.ts";

describe("sidebar controller", function () {
  before(function () {
    installLocaleMock();
  });

  beforeEach(function () {
    installZoteroMock();
  });

  afterEach(function () {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
  });

  it("returns selected sidebar text only when the selection is inside the deck", function () {
    const insideStart = {};
    const insideEnd = {};
    const outside = {};
    const root = {
      contains(node: unknown) {
        return node === insideStart || node === insideEnd;
      },
    };
    const getSidebarSelectionText = (
      __sidebarControllerTestHooks as unknown as {
        getSidebarSelectionText: (win: Window, root?: Node) => string;
      }
    ).getSidebarSelectionText;

    assert.equal(
      getSidebarSelectionText(
        createSelectionWindow({
          anchorNode: insideStart,
          focusNode: insideEnd,
          text: "selected title",
        }),
        root as unknown as Node,
      ),
      "selected title",
    );

    assert.equal(
      getSidebarSelectionText(
        createSelectionWindow({
          anchorNode: insideStart,
          focusNode: outside,
          text: "cross-boundary text",
        }),
        root as unknown as Node,
      ),
      "",
    );
  });

  it("keeps the active paper title as the context label after the conversation label changes", function () {
    const win = new FakeWindow(1200);
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paper = createPaperIdentity();
    const workspace = createItemWorkspaceIdentity(paper);
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      workspace,
      conversation: {
        metadata: {
          ...workspace,
          id: "conv-1",
          scope: "workspace" as const,
          label: "总结一下这篇论文",
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:01:00.000Z",
        },
        messages: [],
      },
    });

    assert.equal(
      controller.viewState.title,
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning / 总结一下这篇论文",
    );
    assert.equal(
      controller.viewState.context.label,
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning",
    );
    assert.equal(
      controller.viewState.context.paperTitle,
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning",
    );
    assert.equal(controller.viewState.context.paperKey, "1:AAA");
    assert.equal(controller.viewState.context.parentItemKey, "AAA");
    assert.equal(controller.viewState.context.attachmentKey, "PDF");
  });

  it("switches from an item workspace to its containing collection", async function () {
    const win = new FakeWindow(1200);
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paper = createPaperIdentity();
    const itemWorkspace = {
      ...createItemWorkspaceIdentity(paper),
      collectionKey: "COLL",
    };
    const collectionWorkspace = {
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection" as const,
      libraryID: 1,
      workspaceLabel: "Large Language Models",
      workspaceTitle: "Large Language Models",
      collectionKey: "COLL",
      collectionPath: ["Large Language Models"],
    };
    let loadedWorkspaceKey = "";
    controller.selectionToken = 1;
    controller.sourceUniverse = {
      createCollectionWorkspace(input: {
        libraryID: number;
        collectionKey: string;
        currentSource?: typeof paper;
      }) {
        assert.equal(input.libraryID, 1);
        assert.equal(input.collectionKey, "COLL");
        assert.isUndefined(input.currentSource);
        return collectionWorkspace;
      },
    };
    controller.loadWorkspaceConversation = async (input: {
      workspace: typeof collectionWorkspace;
    }) => {
      loadedWorkspaceKey = input.workspace.workspaceKey;
    };
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      workspace: itemWorkspace,
      conversation: {
        metadata: {
          ...itemWorkspace,
          id: "conv-1",
          scope: "workspace" as const,
          label: "总结一下这篇论文",
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:01:00.000Z",
        },
        messages: [],
      },
    });

    await controller.selectCollectionWorkspace("COLL");

    assert.equal(loadedWorkspaceKey, "collection:1:COLL");
    assert.equal(controller.selectionToken, 2);
  });

  it("uses a fresh commit token for manual workspace switches", async function () {
    const win = new FakeWindow(1200);
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paper = createPaperIdentity();
    const itemWorkspace = {
      ...createItemWorkspaceIdentity(paper),
      collectionKey: "COLL",
    };
    const collectionWorkspace = {
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection" as const,
      libraryID: 1,
      workspaceLabel: "Large Language Models",
      workspaceTitle: "Large Language Models",
      collectionKey: "COLL",
      collectionPath: ["Large Language Models"],
    };
    let loadToken = 0;
    controller.open = true;
    controller.selectionToken = 8;
    controller.sourceUniverse = {
      createCollectionWorkspace() {
        return collectionWorkspace;
      },
    };
    controller.loadWorkspaceConversation = async (input: {
      token: number;
      workspace: typeof collectionWorkspace;
    }) => {
      loadToken = input.token;
      assert.equal(input.workspace.workspaceKey, "collection:1:COLL");
    };
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      workspace: itemWorkspace,
      conversation: {
        metadata: {
          ...itemWorkspace,
          id: "conv-1",
          scope: "workspace" as const,
          label: "Question",
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:01:00.000Z",
        },
        messages: [],
      },
    });

    await controller.selectCollectionWorkspace("COLL");

    assert.equal(loadToken, 9);
    assert.equal(controller.selectionToken, 9);
  });

  it("keeps background streaming turns from repainting after switching papers", function () {
    const win = new FakeWindow(1200);
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paperA = createPaperIdentity();
    const workspaceA = createItemWorkspaceIdentity(paperA);
    const paperB = {
      ...paperA,
      paperKey: "1:BBB",
      parentItemID: 20,
      parentItemKey: "BBB",
      attachmentItemID: 21,
      attachmentKey: "PDF-B",
      title: "Paper B",
    };
    const workspaceB = createItemWorkspaceIdentity(paperB);
    const conversationA = createConversation(paperA, "conv-a", "Question A");
    const conversationB = createConversation(paperB, "conv-b", "Question B");
    const runningTurn = {
      conversation: conversationA,
      assistantOutput: "partial A",
      interrupting: false,
      interrupted: false,
    };
    controller.open = true;
    controller.runningTurns.set("conv-a", runningTurn);
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      workspace: workspaceA,
      conversation: conversationA,
    });

    controller.setDisplayState({
      kind: "loading",
      token: 2,
      reader: createPDFReader(21, "tab-b"),
      label: "Paper B",
    });
    runningTurn.assistantOutput = "partial A + delta";
    controller.refreshRunningTurnView(runningTurn);

    assert.equal(controller.viewState.title, "Paper B");
    assert.deepEqual(
      controller.viewState.messages.map((item: any) => item.text),
      ["zopilot-sidebar-loading-conversation"],
    );

    controller.setDisplayState({
      kind: "ready",
      token: 2,
      reader: createPDFReader(21, "tab-b"),
      workspace: workspaceB,
      conversation: conversationB,
    });
    runningTurn.assistantOutput = "partial A + later delta";
    controller.refreshRunningTurnView(runningTurn);

    assert.equal(controller.viewState.title, "Paper B / Question B");
    assert.deepEqual(
      controller.viewState.messages.map((item: any) => item.text),
      ["Question B"],
    );

    controller.setDisplayState({
      kind: "ready",
      token: 3,
      reader: createPDFReader(11, "tab-a"),
      workspace: workspaceA,
      conversation: conversationA,
    });

    assert.equal(
      controller.viewState.title,
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning / Question A",
    );
    assert.deepEqual(
      controller.viewState.messages.map((item: any) => item.text),
      ["Question A", "partial A + later delta"],
    );
  });

  it("rejects stale conversation loads after a faster paper switch", async function () {
    const win = new FakeWindow(1200);
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    controller.open = true;

    controller.setDisplayState({
      kind: "loading",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      label: "Paper A",
    });
    controller.selectionToken = 2;
    const paperB = {
      ...createPaperIdentity(),
      paperKey: "1:BBB",
      parentItemID: 20,
      parentItemKey: "BBB",
      attachmentItemID: 21,
      attachmentKey: "PDF-B",
      title: "Paper B",
    };
    controller.setDisplayState({
      kind: "ready",
      token: 2,
      reader: createPDFReader(21, "tab-b"),
      workspace: createItemWorkspaceIdentity(paperB),
      conversation: createConversation(paperB, "conv-b", "Question B"),
    });

    assert.isFalse(controller.canCommitSelection(1));
    assert.equal(controller.viewState.title, "Paper B / Question B");
  });

  it("refreshes stale ready state from the selected reader before workspace actions", async function () {
    const win = new FakeWindow(1200) as FakeWindow & {
      Zotero_Tabs: { selectedID: string; selectedType: string };
    };
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paperA = createPaperIdentity();
    const paperB = {
      ...paperA,
      paperKey: "1:BBB",
      parentItemID: 20,
      parentItemKey: "BBB",
      attachmentItemID: 21,
      attachmentKey: "PDF-B",
      title: "Paper B",
    };
    const readerB = createPDFReader(21, "tab-b");

    controller.open = true;
    win.Zotero_Tabs = { selectedID: "tab-b", selectedType: "reader" };
    (globalThis as unknown as { Zotero: Record<string, any> }).Zotero.Reader = {
      getByTabID(tabID: string) {
        return tabID === "tab-b" ? readerB : undefined;
      },
    };
    (globalThis as unknown as { Zotero: Record<string, any> }).Zotero.Items = {
      get(itemID: number) {
        return itemID === 21 ? { key: "PDF-B" } : { key: "PDF" };
      },
    };
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader: createPDFReader(11, "tab-a"),
      workspace: createItemWorkspaceIdentity(paperA),
      conversation: createConversation(paperA, "conv-a", "Question A"),
    });
    controller.readerSelection.loadReaderConversation = async (
      reader: ReturnType<typeof createPDFReader>,
      token: number,
    ) => {
      assert.strictEqual(reader, readerB);
      controller.setDisplayState({
        kind: "ready",
        token,
        reader,
        workspace: createItemWorkspaceIdentity(paperB),
        conversation: createConversation(paperB, "conv-b", "Question B"),
      });
    };

    const ready = await controller.getReadyStateForActiveContext();

    assert.equal(ready?.workspace.workspaceKey, "item:1:BBB");
    assert.equal(controller.viewState.context.label, "Paper B");
  });

  it("does not invalidate ready state when syncing the already selected reader", async function () {
    const win = new FakeWindow(1200) as FakeWindow & {
      Zotero_Tabs: { selectedID: string; selectedType: string };
    };
    const controller = new (
      __sidebarControllerTestHooks as unknown as {
        SidebarController: new (win: Window) => Record<string, any>;
      }
    ).SidebarController(win as unknown as Window) as Record<string, any>;
    const paper = createPaperIdentity();
    const reader = createPDFReader(11, "tab-a");

    controller.open = true;
    controller.selectionToken = 1;
    win.Zotero_Tabs = { selectedID: "tab-a", selectedType: "reader" };
    (globalThis as unknown as { Zotero: Record<string, any> }).Zotero.Reader = {
      getByTabID(tabID: string) {
        return tabID === "tab-a" ? reader : undefined;
      },
    };
    controller.setDisplayState({
      kind: "ready",
      token: 1,
      reader,
      workspace: createItemWorkspaceIdentity(paper),
      conversation: createConversation(paper, "conv-a", "Question A"),
    });

    await controller.syncWithSelectedContext();

    assert.equal(controller.selectionToken, 1);
    assert.equal(controller.getReadyDisplayState()?.token, 1);
  });

  it("formats PDF helper prompt notices for missing, outdated, and unsupported helpers", function () {
    const createPdfHelperNoticeText = (
      __sidebarControllerTestHooks as unknown as {
        createPdfHelperNoticeText: (status: Record<string, unknown>) => string;
      }
    ).createPdfHelperNoticeText;

    assert.equal(
      createPdfHelperNoticeText({
        status: "not-installed",
        latestVersion: "0.2.0",
        hasInstallCandidate: false,
      }),
      "zopilot-sidebar-pdf-helper-not-installed",
    );
    assert.equal(
      createPdfHelperNoticeText({
        status: "outdated",
        latestVersion: "0.2.0",
        installedVersion: "0.1.0",
        hasInstallCandidate: true,
      }),
      "zopilot-sidebar-pdf-helper-update-required",
    );
    assert.equal(
      createPdfHelperNoticeText({
        status: "unsupported",
        latestVersion: "0.2.0",
        version: "0.2.0",
        hasInstallCandidate: false,
        needsUpdate: false,
        installCandidateDirs: [],
        installDir: "/profile/zopilot/runtime/pdf-helper",
        executablePath: "",
        manifestUrl: "https://example.test/pdf-helper-manifest.json",
        reason: "Unsupported platform.",
      }),
      "zopilot-sidebar-pdf-helper-unsupported",
    );
  });
});

type FakeListener = (event: Event) => void;

function createSelectionWindow(options: {
  anchorNode: unknown;
  focusNode: unknown;
  text: string;
}): Window {
  return {
    getSelection() {
      return {
        anchorNode: options.anchorNode,
        focusNode: options.focusNode,
        isCollapsed: false,
        rangeCount: 1,
        toString() {
          return options.text;
        },
      };
    },
  } as unknown as Window;
}

function createPaperIdentity() {
  return {
    paperKey: "1:AAA",
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: "AAA",
    attachmentItemID: 11,
    attachmentKey: "PDF",
    title: "DeepSeekMath: Pushing the Limits of Mathematical Reasoning",
  };
}

function createPDFReader(itemID: number, tabID: string) {
  return {
    itemID,
    tabID,
    type: "pdf" as const,
  };
}

function createConversation(
  paper: ReturnType<typeof createPaperIdentity>,
  id: string,
  label: string,
) {
  const workspace = createItemWorkspaceIdentity(paper);
  return {
    metadata: {
      ...workspace,
      id,
      scope: "workspace" as const,
      label,
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:01:00.000Z",
    },
    messages: [
      {
        id: `${id}-user`,
        conversationId: id,
        role: "user" as const,
        text: label,
        createdAt: "2026-06-16T00:00:01.000Z",
        status: "complete" as const,
      },
    ],
  };
}

class FakeWindow {
  readonly document: FakeDocument;
  readonly URL = URL;
  readonly Event = class {
    constructor(readonly type: string) {}
  };
  private readonly listeners = new Map<string, Set<FakeListener>>();

  constructor(readonly innerWidth: number) {
    this.document = new FakeDocument(innerWidth);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const listeners = this.listeners.get(type) || new Set<FakeListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    callback(0);
    return 1;
  }
}

class FakeDocument {
  readonly documentElement: { clientWidth: number };

  constructor(clientWidth: number) {
    this.documentElement = { clientWidth };
  }
}

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                messages: Array<{ id: string }>,
              ) => Array<{ value: string }>;
            };
          };
        };
      };
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}

function installZoteroMock(): void {
  (
    globalThis as typeof globalThis & {
      Zotero: {
        rtl: boolean;
        Prefs: {
          get: () => unknown;
          set: (key: string, value: unknown, global: boolean) => void;
        };
      };
    }
  ).Zotero = {
    rtl: false,
    Prefs: {
      get: () => undefined,
      set: () => undefined,
    },
  };
}
