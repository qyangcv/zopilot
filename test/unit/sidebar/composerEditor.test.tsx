import { assert } from "chai";
import {
  createRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { PaperSourceRef } from "../../../src/domain/conversation.ts";
import { ComposerEditor } from "../../../src/features/sidebar/ui/ComposerEditor.tsx";
import type { ComposerBindings } from "../../../src/features/sidebar/ui/composerBindings.ts";
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
    addLocalAttachment: () => undefined,
    bottomDockRef: createRef<HTMLDivElement>(),
    commandAnchor: "input",
    commandAnchorRef: createRef<HTMLElement>(),
    commandButtonRef: createRef<HTMLButtonElement>(),
    commandOpen: false,
    composerRef: createRef<HTMLFormElement>(),
    draft: "@",
    executeCommand: () => undefined,
    insertPrompt: () => undefined,
    localAttachments: [],
    mentionCandidates: candidates,
    mentions: [],
    moveMentionSelection: move,
    promptButtonRef: createRef<HTMLButtonElement>(),
    promptPickerOpen: false,
    removeLocalAttachment: () => undefined,
    removeMention: () => undefined,
    selectMention: select,
    setCommandAnchor: () => undefined,
    setCommandOpen: () => undefined,
    setCommandQuery: () => undefined,
    setMentionQuery: () => undefined,
    setPromptPickerOpen: () => undefined,
    submit,
    textareaRef: createRef<HTMLTextAreaElement>(),
    updateDraft: () => undefined,
    visibleCommands: [],
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
