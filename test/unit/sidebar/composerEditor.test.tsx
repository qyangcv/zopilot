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
import { ComposerPromptPicker } from "../../../src/features/sidebar/ui/Composer.tsx";
import { ComposerEditor } from "../../../src/features/sidebar/ui/ComposerEditor.tsx";
import { ComposerFooter } from "../../../src/features/sidebar/ui/ComposerFooter.tsx";
import type { ComposerBindings } from "../../../src/features/sidebar/ui/composerBindings.ts";
import { countItemContextSelections } from "../../../src/features/sidebar/ui/itemContextGroups.ts";
import { ContextChips } from "../../../src/features/sidebar/ui/ContextChips.tsx";
import { ItemContextMentionPopover } from "../../../src/features/sidebar/ui/ItemContextMentionPopover.tsx";
import { MentionPopover } from "../../../src/features/sidebar/ui/MentionPopover.tsx";
import { PromptPicker } from "../../../src/features/sidebar/ui/PromptPicker.tsx";
import { FloatingPortal } from "../../../src/ui/primitives/FloatingPortal.tsx";
import type {
  SidebarActions,
  SidebarState,
} from "../../../src/features/sidebar/ui/types.ts";

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

    const firstBindings = createBindings({
      activeMentionIndex: 0,
      candidates,
      move: (direction) => moves.push(direction),
      select: (source) => selected.push(source),
      submit: () => submitCount++,
    });
    const firstEditor = ComposerEditor({
      bindings: firstBindings,
      state: { composerEnabled: true } as SidebarState,
    });
    const firstKeyDown = getTextareaKeyDown(firstEditor);
    const floating = findElement(
      firstEditor,
      (element) => element.type === FloatingPortal,
    );
    assert.isDefined(floating);
    assert.isTrue(pressKey(firstKeyDown, "ArrowDown"));
    assert.isTrue(pressKey(firstKeyDown, "ArrowUp"));
    assert.equal(getProps(floating).anchorRef, firstBindings.composerRef);

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

  it("inserts prompt text without replacing selected context", function () {
    const mention = {
      id: "mention:paper",
      ...createSource("paper"),
    };
    const inserted: string[] = [];
    const bindings = {
      ...createBindings({
        activeMentionIndex: 0,
        candidates: [],
        move: () => undefined,
        select: () => undefined,
        submit: () => undefined,
      }),
      insertPrompt: (text: string) => inserted.push(text),
      mentions: [mention],
      promptPickerOpen: true,
    };
    const picker = ComposerPromptPicker({
      bindings,
      state: {
        prompts: [{ body: "Prompt-3 body", id: "prompt-3", title: "Prompt-3" }],
      } as SidebarState,
    });
    const promptPicker = findElement(
      picker,
      (element) => element.type === PromptPicker,
    );

    assert.isDefined(promptPicker);
    (getProps(promptPicker).onInsert as (body: string) => void)(
      "Prompt-3 body",
    );
    assert.deepEqual(inserted, ["Prompt-3 body"]);
    assert.deepEqual(bindings.mentions, [mention]);
  });

  it("ends the native editing session before opening the prompt picker", function () {
    let blurCount = 0;
    const bindings = createBindings({
      activeMentionIndex: 0,
      candidates: [],
      move: () => undefined,
      select: () => undefined,
      submit: () => undefined,
    });
    (
      bindings.textareaRef as {
        current: Pick<HTMLTextAreaElement, "blur"> | null;
      }
    ).current = {
      blur: () => blurCount++,
    };
    const footer = ComposerFooter({
      actions: {} as SidebarActions,
      bindings,
      state: {
        backendStatus: "connected",
        composerEnabled: true,
        context: { workspaceKey: "library:1" },
        models: [],
      } as SidebarState,
    });
    const promptButton = findElement(
      footer,
      (element) =>
        element.type === "button" &&
        getProps(element)["aria-haspopup"] === "dialog",
    );

    assert.isDefined(promptButton);
    (getProps(promptButton).onMouseDown as () => void)();
    assert.equal(blurCount, 1);
  });

  it("publishes every native input without React change-value deduplication", function () {
    const nativeInputs: Array<[string, number | null]> = [];
    const bindings = {
      ...createBindings({
        activeMentionIndex: 0,
        candidates: [],
        move: () => undefined,
        select: () => undefined,
        submit: () => undefined,
      }),
      hasDraftText: true,
      handleEditorInput: (textarea: HTMLTextAreaElement) =>
        nativeInputs.push([textarea.value, textarea.selectionStart]),
    };
    const editor = ComposerEditor({
      bindings,
      state: { composerEnabled: true } as SidebarState,
    });
    const textarea = findElement(
      editor,
      (element) => element.type === "textarea",
    );

    assert.isDefined(textarea);
    const props = getProps(textarea);
    assert.notProperty(props, "value");
    assert.notProperty(props, "defaultValue");
    assert.notProperty(props, "onChange");

    (props.onInput as (event: { currentTarget: HTMLTextAreaElement }) => void)({
      currentTarget: {
        selectionStart: 6,
        value: "native",
      } as HTMLTextAreaElement,
    });
    assert.deepEqual(nativeInputs, [["native", 6]]);
  });

  it("does not intercept native editing shortcuts", function () {
    const editor = ComposerEditor({
      bindings: createBindings({
        activeMentionIndex: 0,
        candidates: [],
        move: () => undefined,
        select: () => undefined,
        submit: () => undefined,
      }),
      state: { composerEnabled: true } as SidebarState,
    });
    const onKeyDown = getTextareaKeyDown(editor);

    for (const key of ["a", "c", "x", "v", "z", "Backspace", "Delete"]) {
      assert.isFalse(pressKey(onKeyDown, key), key);
    }
  });

  it("leaves modified editing keys native while a picker is open", function () {
    const editor = ComposerEditor({
      bindings: createBindings({
        activeMentionIndex: 0,
        candidates: [createSource("paper")],
        move: () => {
          throw new Error("modified navigation must stay in the textarea");
        },
        select: () => undefined,
        submit: () => undefined,
      }),
      state: { composerEnabled: true } as SidebarState,
    });
    const onKeyDown = getTextareaKeyDown(editor);

    assert.isFalse(pressKey(onKeyDown, "a", { metaKey: true }));
    assert.isFalse(pressKey(onKeyDown, "c", { ctrlKey: true }));
    assert.isFalse(pressKey(onKeyDown, "ArrowLeft", { altKey: true }));
    assert.isFalse(pressKey(onKeyDown, "ArrowDown", { shiftKey: true }));
  });

  it("moves the single active highlight to the hovered mention", function () {
    const activeIndexes: number[] = [];
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 0,
          candidates: [createSource("a"), createSource("b")],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        setActiveMentionIndex: (index) => activeIndexes.push(index),
      },
      state: { composerEnabled: true } as SidebarState,
    });
    const popover = findElement(
      editor,
      (element) => element.type === MentionPopover,
    );

    assert.isDefined(popover);
    (getProps(popover).onActiveIndexChange as (index: number) => void)(1);
    assert.deepEqual(activeIndexes, [1]);
  });

  it("uses Home and End for the first and last mention candidates", function () {
    const activeIndexes: number[] = [];
    const editor = ComposerEditor({
      bindings: {
        ...createBindings({
          activeMentionIndex: 1,
          candidates: [createSource("a"), createSource("b"), createSource("c")],
          move: () => undefined,
          select: () => undefined,
          submit: () => undefined,
        }),
        setActiveMentionIndex: (index) => activeIndexes.push(index),
      },
      state: { composerEnabled: true } as SidebarState,
    });
    const onKeyDown = getTextareaKeyDown(editor);

    assert.isTrue(pressKey(onKeyDown, "Home"));
    assert.isTrue(pressKey(onKeyDown, "End"));
    assert.deepEqual(activeIndexes, [0, 2]);
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
      kind: "item",
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

  it("renders each collection tree selection as its own chip", function () {
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
      [root.sourceId, supplement.sourceId, other.sourceId],
    );
    assert.deepEqual(
      (getProps(chips).notes as Array<{ id: string }>).map((note) => note.id),
      ["note:1:NOTE"],
    );
    assert.isUndefined(getProps(chips).itemContext);
    (getProps(chips).onOpenMention as (mention: typeof root) => void)(
      supplement,
    );
    assert.deepEqual(opened, [supplement.sourceId]);
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

  it("renders a standalone Reader source as a fixed PDF chip", function () {
    const editor = ComposerEditor({
      bindings: createBindings({
        activeMentionIndex: 0,
        candidates: [],
        move: () => undefined,
        select: () => undefined,
        submit: () => undefined,
      }),
      state: {
        composerEnabled: true,
        context: {
          attachmentKey: "PDF",
          hostContextKind: "reader",
          label: "Standalone.pdf",
          standalonePdf: true,
          workspaceType: "item",
        },
      } as SidebarState,
    });
    const chips = findElement(
      editor,
      (element) => element.type === ContextChips,
    );

    assert.isDefined(chips);
    assert.deepEqual(getProps(chips).itemContext, {
      expanded: false,
      kind: "pdf",
      title: "Standalone.pdf",
    });
    assert.isUndefined(getProps(chips).onOpenItemContext);
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
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey: boolean;
  preventDefault: () => void;
}) => void;

function pressKey(
  handler: KeyDownHandler,
  key: string,
  modifiers: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {},
): boolean {
  let prevented = false;
  handler({
    ...modifiers,
    key,
    shiftKey: modifiers.shiftKey ?? false,
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
    addDroppedContext: () => undefined,
    addLocalAttachment: () => undefined,
    bottomDockRef: createRef<HTMLDivElement>(),
    closeItemContextPicker: () => undefined,
    composerRef: createRef<HTMLFormElement>(),
    hasDraftText: true,
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
    setActiveMentionIndex: () => undefined,
    setActiveItemContextIndex: () => undefined,
    setItemContextExpanded: () => undefined,
    setMentionQuery: () => undefined,
    setPromptPickerOpen: () => undefined,
    submit,
    textareaCallbackRef: () => undefined,
    textareaRef: createRef<HTMLTextAreaElement>(),
    handleEditorBlur: () => undefined,
    handleEditorCompositionEnd: () => undefined,
    handleEditorCompositionStart: () => undefined,
    handleEditorInput: () => undefined,
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
