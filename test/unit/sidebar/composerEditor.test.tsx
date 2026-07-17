import { assert } from "chai";
import {
  createRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  LocalAttachmentRef,
  ItemContextTree,
  PaperSourceRef,
} from "../../../src/domain/conversation.ts";
import { ComposerEditor } from "../../../src/features/sidebar/ui/ComposerEditor.tsx";
import type { ComposerBindings } from "../../../src/features/sidebar/ui/composerBindings.ts";
import { countItemContextSelections } from "../../../src/features/sidebar/ui/itemContextGroups.ts";
import { ContextChips } from "../../../src/features/sidebar/ui/ContextChips.tsx";
import { ItemContextMentionPopover } from "../../../src/features/sidebar/ui/ItemContextMentionPopover.tsx";
import { MentionPopover } from "../../../src/features/sidebar/ui/MentionPopover.tsx";
import { FloatingPortal } from "../../../src/ui/primitives/FloatingPortal.tsx";
import type { SidebarState } from "../../../src/features/sidebar/ui/types.ts";

describe("sidebar composer mention keyboard navigation", function () {
  before(function () {
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
            formatMessagesSync: (messages) =>
              messages.map((message) => ({ value: message.id })),
          },
        },
      },
    };
  });

  it("moves with arrow keys and selects the active candidate with Enter", function () {
    const candidates = [createSource("a"), createSource("b")];
    const moves: Array<-1 | 1> = [];
    const selected: PaperSourceRef[] = [];
    let submitCount = 0;

    const firstEditor = ComposerEditor({
      bindings: createBindings({
        activeMentionIndex: 0,
        candidates,
        move: (direction) => moves.push(direction),
        select: (source) => selected.push(source),
        submit: () => submitCount++,
      }),
      state: { composerEnabled: true } as SidebarState,
    });
    const firstKeyDown = getTextareaKeyDown(firstEditor);
    assert.isTrue(pressKey(firstKeyDown, "ArrowDown"));
    assert.isTrue(pressKey(firstKeyDown, "ArrowUp"));

    const secondEditor = ComposerEditor({
      bindings: createBindings({
        activeMentionIndex: 1,
        candidates,
        move: (direction) => moves.push(direction),
        select: (source) => selected.push(source),
        submit: () => submitCount++,
      }),
      state: { composerEnabled: true } as SidebarState,
    });
    assert.isTrue(pressKey(getTextareaKeyDown(secondEditor), "Enter"));

    assert.deepEqual(moves, [1, -1]);
    assert.equal(selected[0]?.sourceId, "b");
    assert.equal(submitCount, 0);
  });

  it("navigates and selects Reader item context tree nodes", function () {
    const selected: string[] = [];
    const moves: Array<-1 | 1> = [];
    let closeCount = 0;
    const tree = createItemContextTree();
    const bindings = {
      ...createBindings({
        activeMentionIndex: 0,
        candidates: [],
        move: () => undefined,
        select: () => undefined,
        submit: () => undefined,
      }),
      activeItemContextIndex: 1,
      itemContextExpanded: true,
      itemContextNodes: tree.nodes,
      itemContextPickerOpen: true,
      itemContextTree: tree,
      closeItemContextPicker: () => closeCount++,
      moveItemContextSelection: (direction: -1 | 1) => moves.push(direction),
      selectItemContext: (node: ItemContextTree["nodes"][number]) =>
        selected.push(node.id),
    };
    const editor = ComposerEditor({
      bindings,
      state: { composerEnabled: true } as SidebarState,
    });
    const onKeyDown = getTextareaKeyDown(editor);
    const floating = findElement(
      editor,
      (element) => element.type === FloatingPortal,
    );
    assert.isDefined(floating);

    assert.isTrue(pressKey(onKeyDown, "ArrowDown"));
    assert.isTrue(pressKey(onKeyDown, "Enter"));
    assert.isTrue(pressKey(onKeyDown, "Escape"));

    assert.deepEqual(moves, [1]);
    assert.deepEqual(selected, ["note:1:NOTE"]);
    assert.equal(closeCount, 1);
    assert.equal(getProps(floating).anchorRef, bindings.composerRef);
  });

  it("hides item tree selections from composer chips", function () {
    const tree = createItemContextTree();
    let openCount = 0;
    const attachment: LocalAttachmentRef = {
      id: "local",
      path: "/tmp/local.pdf",
      filename: "local.pdf",
      kind: "pdf",
    };
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 0,
          candidates: [],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        itemContextTree: tree,
        localAttachments: [attachment],
        mentions: [
          {
            id: "mention:other",
            ...createSource("other"),
          },
        ],
        noteContexts: [
          tree.nodes[0]?.kind === "note"
            ? tree.nodes[0].note
            : assert.fail("Expected note node"),
        ],
        openItemContextPicker: () => openCount++,
      },
      state: {
        composerEnabled: true,
        context: {
          hostContextKind: "reader",
          workspaceType: "item",
        },
      } as SidebarState,
    });

    const chips = findElement(
      editor,
      (element) => element.type === ContextChips,
    );
    assert.isDefined(chips);
    assert.deepEqual(getProps(chips).attachments, [attachment]);
    assert.deepEqual(getProps(chips).itemContext, {
      expanded: false,
      title: "Paper",
    });
    assert.deepEqual(getProps(chips).mentions, []);
    assert.deepEqual(getProps(chips).notes, []);
    (getProps(chips).onOpenItemContext as () => void)();
    assert.equal(openCount, 1);
  });

  it("passes the total context limit state to the item tree", function () {
    const tree = createItemContextTree();
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 0,
          candidates: [],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        itemContextPickerOpen: true,
        itemContextLimitReached: true,
        itemContextTree: tree,
        itemContextNodes: tree.nodes,
        mentions: Array.from({ length: 12 }, (_, index) => ({
          id: `mention:${index}`,
          ...createSource(`source-${index}`),
        })),
        noteContexts: [
          tree.nodes[0]?.kind === "note"
            ? tree.nodes[0].note
            : assert.fail("Expected note node"),
        ],
      },
      state: { composerEnabled: true } as SidebarState,
    });
    const popover = findElement(
      editor,
      (element) => element.type === ItemContextMentionPopover,
    );

    assert.isDefined(popover);
    assert.isTrue(getProps(popover).limitReached);
    assert.equal(
      countItemContextSelections(
        [
          {
            id: "mention:root",
            ...createSource("root"),
          },
          {
            id: "mention:sibling",
            ...createSource("sibling"),
            parentItemKey: "root",
          },
        ],
        [],
        true,
      ),
      3,
    );
  });

  it("groups collection tree children under clickable item chips", function () {
    const tree = createItemContextTree();
    const root = {
      id: "mention:paper",
      ...createSource("paper"),
    };
    const supplement = {
      id: "mention:supplement",
      ...createSource("supplement"),
      libraryID: root.libraryID,
      parentItemID: root.parentItemID,
      parentItemKey: root.parentItemKey,
      paperKey: root.paperKey,
    };
    const other = {
      id: "mention:other",
      ...createSource("other"),
    };
    const opened: string[] = [];
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 0,
          candidates: [],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        itemContextPickerOpen: true,
        itemContextSourceId: root.sourceId,
        itemContextTree: tree,
        itemContextNodes: tree.nodes,
        mentions: [root, supplement, other],
        noteContexts: [
          {
            id: "note:1:NOTE",
            libraryID: root.libraryID,
            parentItemID: root.parentItemID,
            parentItemKey: root.parentItemKey,
            noteItemID: 12,
            noteItemKey: "NOTE",
            title: "Reading notes",
            dateModified: "2026-07-17 10:00:00",
          },
        ],
        openItemContextPicker: (mention) => {
          if (mention) opened.push(mention.sourceId);
        },
      },
      state: {
        composerEnabled: true,
        context: {
          hostContextKind: "library",
          workspaceType: "collection",
        },
      } as SidebarState,
    });

    const chips = findElement(
      editor,
      (element) => element.type === ContextChips,
    );
    assert.isDefined(chips);
    assert.deepEqual(
      (getProps(chips).mentions as PaperSourceRef[]).map(
        (mention) => mention.sourceId,
      ),
      [root.sourceId, other.sourceId],
    );
    assert.deepEqual(getProps(chips).notes, []);
    assert.isUndefined(getProps(chips).itemContext);
    (getProps(chips).onOpenMention as (mention: typeof root) => void)(root);
    assert.deepEqual(opened, [root.sourceId]);
  });

  it("does not open a selector from @ in an item workspace", function () {
    const tree = createItemContextTree();
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 0,
          candidates: [],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        itemContextTree: tree,
      },
      state: {
        composerEnabled: true,
        context: {
          hostContextKind: "reader",
          workspaceType: "item",
        },
      } as SidebarState,
    });

    assert.isUndefined(
      findElement(
        editor,
        (element) => element.type === ItemContextMentionPopover,
      ),
    );
    assert.isUndefined(
      findElement(editor, (element) => element.type === MentionPopover),
    );
  });

  it("uses item-tree chips for collection and library in both surfaces", function () {
    const mention = {
      id: "mention:paper",
      ...createSource("paper"),
    };
    for (const hostContextKind of ["reader", "library"] as const) {
      for (const workspaceType of ["collection", "library"] as const) {
        const editor = ComposerEditor({
          bindings: {
            ...createBindings({
              activeMentionIndex: 0,
              candidates: [],
              move: () => undefined,
              select: () => undefined,
              submit: () => undefined,
            }),
            mentions: [mention],
          },
          state: {
            composerEnabled: true,
            context: { hostContextKind, workspaceType },
          } as SidebarState,
        });
        const chips = findElement(
          editor,
          (element) => element.type === ContextChips,
        );

        assert.isDefined(chips);
        assert.isUndefined(getProps(chips).itemContext);
        assert.deepEqual(getProps(chips).mentions, [mention]);
        assert.isFunction(getProps(chips).onOpenMention);
      }
    }
  });
});

type KeyDownHandler = (event: {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}) => void;

function pressKey(handler: KeyDownHandler, key: string): boolean {
  let prevented = false;
  handler({
    key,
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

function getTextareaKeyDown(node: ReactNode): KeyDownHandler {
  const textarea = findElement(node, (element) => element.type === "textarea");
  assert.isDefined(textarea);
  return getProps(textarea).onKeyDown as KeyDownHandler;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  return findElement(getProps(node).children as ReactNode, predicate);
}

function getProps(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

function createBindings({
  activeMentionIndex,
  candidates,
  move,
  select,
  submit,
}: {
  activeMentionIndex: number;
  candidates: PaperSourceRef[];
  move: (direction: -1 | 1) => void;
  select: (source: PaperSourceRef) => void;
  submit: () => void;
}): ComposerBindings {
  return {
    activeMentionIndex,
    activeItemContextIndex: 0,
    addLocalAttachment: () => undefined,
    bottomDockRef: createRef<HTMLDivElement>(),
    closeItemContextPicker: () => undefined,
    composerRef: createRef<HTMLFormElement>(),
    draft: "@",
    insertPrompt: () => undefined,
    itemContextExpanded: true,
    itemContextLimitReached: false,
    itemContextNodes: [],
    itemContextPickerOpen: false,
    itemContextSourceId: undefined,
    itemContextTree: undefined,
    localAttachments: [],
    mentionCandidates: candidates,
    mentions: [],
    noteContexts: [],
    moveItemContextSelection: () => undefined,
    moveMentionSelection: move,
    openItemContextPicker: () => undefined,
    promptButtonRef: createRef<HTMLButtonElement>(),
    promptPickerOpen: false,
    removeLocalAttachment: () => undefined,
    removeMention: () => undefined,
    removeNoteContext: () => undefined,
    selectItemContext: () => undefined,
    selectMention: select,
    setActiveItemContextIndex: () => undefined,
    setItemContextExpanded: () => undefined,
    setMentionQuery: () => undefined,
    setPromptPickerOpen: () => undefined,
    submit,
    textareaRef: createRef<HTMLTextAreaElement>(),
    updateDraft: () => undefined,
  };
}

function createItemContextTree(): ItemContextTree {
  return {
    root: { itemID: 1, itemKey: "PAPER", title: "Paper" },
    nodes: [
      {
        id: "note:1:NOTE",
        kind: "note",
        title: "Reading notes",
        selectable: true,
        note: {
          id: "note:1:NOTE",
          libraryID: 1,
          parentItemID: 1,
          parentItemKey: "PAPER",
          noteItemID: 12,
          noteItemKey: "NOTE",
          title: "Reading notes",
          dateModified: "2026-07-17 10:00:00",
        },
      },
    ],
  };
}

function createSource(sourceId: string): PaperSourceRef {
  return {
    sourceId,
    paperKey: `1:${sourceId}`,
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: sourceId,
    attachmentItemID: 11,
    attachmentKey: `PDF-${sourceId}`,
    title: `Paper ${sourceId.toUpperCase()}`,
  };
}
