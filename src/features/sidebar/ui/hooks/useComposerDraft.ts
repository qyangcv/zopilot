import { useEffect, useRef, useState } from "react";
import type {
  ItemContextNode,
  ItemContextTree,
  LocalAttachmentRef,
  NoteContextRef,
  SourceMention,
} from "../../../../domain/conversation";
import type { ComposerBindings } from "../composerBindings";
import { resizeTextarea } from "../composerLayout";
import type { SidebarActions, SidebarState } from "../types";
import {
  countItemContextSelections,
  sameItemContext,
} from "../itemContextGroups";
import { useMentionPicker } from "./useMentionPicker";
import {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchItemContextNodes,
  moveMentionCandidateIndex,
  sourceToMention,
} from "../mentions";

const SELECTED_CONTEXT_PROMPT = "Use the selected context.";

type ComposerDraftController = {
  bindings: ComposerBindings;
  insertPrompt: (
    text: string,
    mentions?: SourceMention[],
    noteContexts?: NoteContextRef[],
    attachments?: LocalAttachmentRef[],
  ) => void;
  submit: (
    text?: string,
    mentions?: SourceMention[],
    noteContexts?: NoteContextRef[],
    attachments?: LocalAttachmentRef[],
  ) => void;
};

function useComposerDraft(
  actions: SidebarActions,
  state: SidebarState,
): ComposerDraftController {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SourceMention[]>([]);
  const [noteContexts, setNoteContexts] = useState<NoteContextRef[]>([]);
  const [localAttachments, setLocalAttachments] = useState<
    LocalAttachmentRef[]
  >([]);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [itemContextExpanded, setItemContextExpanded] = useState(true);
  const [itemContextPickerRequestedOpen, setItemContextPickerRequestedOpen] =
    useState(false);
  const [itemContextSourceId, setItemContextSourceId] = useState<
    string | undefined
  >(undefined);
  const [selectedItemContextTree, setSelectedItemContextTree] = useState<
    ItemContextTree | undefined
  >(undefined);
  const [activeItemContextIndex, setActiveItemContextIndex] = useState(1);
  const composerScopeRef = useRef("");
  const itemContextLoadTokenRef = useRef(0);
  const noteContextsRef = useRef(noteContexts);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceCandidates = state.sourceCandidates || [];
  const mentionSourceCandidates =
    state.context.workspaceType === "item" ? [] : sourceCandidates;
  const workspaceItemContextTree = state.itemContextTree;
  const readerItemContextMode =
    state.context.hostContextKind === "reader" &&
    state.context.workspaceType === "item";
  const itemContextTree = itemContextSourceId
    ? selectedItemContextTree
    : workspaceItemContextTree;
  noteContextsRef.current = noteContexts;
  const currentSourceId = sourceCandidates.find(
    (source) => source.paperKey === state.context.paperKey,
  )?.sourceId;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    const composerScope = [
      state.context.hostContextKind || "",
      state.context.workspaceKey || "",
      state.conversationId || "",
    ].join(":");
    if (composerScopeRef.current === composerScope) return;
    composerScopeRef.current = composerScope;
    setDraft("");
    setMentions([]);
    const nextNoteContexts: NoteContextRef[] = [];
    noteContextsRef.current = nextNoteContexts;
    setNoteContexts(nextNoteContexts);
    setLocalAttachments([]);
    setPromptPickerOpen(false);
    setItemContextExpanded(true);
    setItemContextPickerRequestedOpen(false);
    setItemContextSourceId(undefined);
    setSelectedItemContextTree(undefined);
    itemContextLoadTokenRef.current += 1;
    setActiveItemContextIndex(1);
  }, [
    state.context.hostContextKind,
    state.context.workspaceKey,
    state.conversationId,
  ]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  const updateDraftWithoutMention = (text: string) => {
    setDraft(text);
  };
  const selectedContextCount = countItemContextSelections(
    mentions,
    noteContexts,
    Boolean(readerItemContextMode && workspaceItemContextTree),
  );
  const mentionPicker = useMentionPicker({
    currentSourceId,
    draft,
    mentions,
    onDraftChange: updateDraftWithoutMention,
    selectedContextCount,
    setMentions,
    sourceCandidates: mentionSourceCandidates,
    textareaRef,
  });
  const itemContextPickerOpen = Boolean(
    itemContextPickerRequestedOpen && itemContextTree,
  );
  const catalogItemContextNodeIds = new Set(
    itemContextTree?.nodes.map((node) => node.id) || [],
  );
  const unavailableSelectedNoteNodes: ItemContextNode[] = noteContexts
    .filter(
      (note) =>
        note.parentItemKey === itemContextTree?.root.itemKey &&
        !catalogItemContextNodeIds.has(note.id),
    )
    .map((note) => ({
      id: note.id,
      kind: "note",
      title: note.title,
      selectable: true,
      invalidReason: "unavailable",
      note,
    }));
  const itemContextNodes =
    itemContextPickerOpen && itemContextTree
      ? matchItemContextNodes("", [
          ...itemContextTree.nodes,
          ...unavailableSelectedNoteNodes,
        ])
      : [];
  const resolvedItemContextExpanded = itemContextExpanded;
  const itemContextRowCount = resolvedItemContextExpanded
    ? itemContextNodes.length + 1
    : 1;
  const resolvedActiveItemContextIndex = Math.min(
    activeItemContextIndex,
    Math.max(itemContextRowCount - 1, 0),
  );
  const setMentionQuery = (
    query: ReturnType<typeof findMentionQuery> | null,
  ) => {
    mentionPicker.setMentionQuery(query);
  };
  const updateDraft = (text: string, cursor?: number) => {
    updateDraftWithoutMention(text);
    itemContextLoadTokenRef.current += 1;
    setItemContextPickerRequestedOpen(false);
    setItemContextSourceId(undefined);
    setSelectedItemContextTree(undefined);
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
  };

  const submit = (
    text = draft,
    nextMentions = mentions,
    nextNoteContexts?: NoteContextRef[],
    nextLocalAttachments = localAttachments,
  ) => {
    const trimmed = text.trim();
    const effectiveNoteContexts = nextNoteContexts ?? noteContextsRef.current;
    if (
      (!trimmed &&
        !nextMentions.length &&
        !effectiveNoteContexts.length &&
        !nextLocalAttachments.length) ||
      state.busy ||
      !state.composerEnabled
    ) {
      return;
    }
    if (nextNoteContexts !== undefined) {
      noteContextsRef.current = [...effectiveNoteContexts];
      setNoteContexts([...effectiveNoteContexts]);
    }
    actions.submitPrompt({
      text: trimmed || SELECTED_CONTEXT_PROMPT,
      mentions: nextMentions,
      noteContexts: effectiveNoteContexts,
      persistNoteContexts: false,
      localAttachments: nextLocalAttachments,
    });
    setDraft("");
    setMentions([]);
    noteContextsRef.current = [];
    setNoteContexts([]);
    setLocalAttachments([]);
    itemContextLoadTokenRef.current += 1;
    setItemContextPickerRequestedOpen(false);
    setItemContextSourceId(undefined);
    setSelectedItemContextTree(undefined);
    setMentionQuery(null);
  };

  const insertPrompt = (
    text: string,
    nextMentions: SourceMention[] = [],
    nextNoteContexts?: NoteContextRef[],
    nextLocalAttachments: LocalAttachmentRef[] = [],
  ) => {
    setMentions([...nextMentions]);
    if (nextNoteContexts !== undefined) {
      const effectiveNoteContexts = [...nextNoteContexts];
      noteContextsRef.current = effectiveNoteContexts;
      setNoteContexts(effectiveNoteContexts);
    }
    setLocalAttachments([...nextLocalAttachments]);
    updateDraft(text);
    globalThis.setTimeout(() => {
      textareaRef.current?.focus();
      resizeTextarea(textareaRef.current);
    }, 0);
  };

  const addLocalAttachment = () => {
    void actions
      .uploadAttachment()
      .then((attachments) => {
        if (!attachments.length) {
          return;
        }
        setLocalAttachments((items) => {
          const existingPaths = new Set(items.map((item) => item.path));
          return [
            ...items,
            ...attachments.filter((attachment) => {
              if (existingPaths.has(attachment.path)) return false;
              existingPaths.add(attachment.path);
              return true;
            }),
          ];
        });
        globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch(() => undefined);
  };

  const closeItemContextPicker = () => {
    itemContextLoadTokenRef.current += 1;
    setItemContextPickerRequestedOpen(false);
    setItemContextSourceId(undefined);
    setSelectedItemContextTree(undefined);
    globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const openItemContextPicker = (source?: SourceMention) => {
    setPromptPickerOpen(false);
    setMentionQuery(null);
    setItemContextExpanded(true);
    setActiveItemContextIndex(1);
    setItemContextPickerRequestedOpen(true);
    if (!source) {
      itemContextLoadTokenRef.current += 1;
      setItemContextSourceId(undefined);
      setSelectedItemContextTree(undefined);
      if (!workspaceItemContextTree) {
        setItemContextPickerRequestedOpen(false);
      }
      globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    const token = ++itemContextLoadTokenRef.current;
    setItemContextSourceId(source.sourceId);
    setSelectedItemContextTree(undefined);
    void actions
      .getItemContextTree(source)
      .then((tree) => {
        if (token !== itemContextLoadTokenRef.current) return;
        if (!tree) {
          setItemContextPickerRequestedOpen(false);
          setItemContextSourceId(undefined);
          return;
        }
        setSelectedItemContextTree(tree);
        setActiveItemContextIndex(tree.nodes.length ? 1 : 0);
      })
      .catch(() => {
        if (token !== itemContextLoadTokenRef.current) return;
        setItemContextPickerRequestedOpen(false);
        setItemContextSourceId(undefined);
        setSelectedItemContextTree(undefined);
      });
    globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const selectItemContext = (
    node: ItemContextNode,
    options: { keepOpen?: boolean } = {},
  ) => {
    if (!itemContextPickerOpen || !node.selectable) {
      return;
    }
    if (node.kind === "pdf") {
      if (!node.current) {
        const selected = mentions.some(
          (mention) => mention.sourceId === node.source.sourceId,
        );
        if (!selected && selectedContextCount >= MAX_SOURCE_MENTIONS) {
          return;
        }
        setMentions((items) =>
          items.some((mention) => mention.sourceId === node.source.sourceId)
            ? items.filter(
                (mention) => mention.sourceId !== node.source.sourceId,
              )
            : [...items, sourceToMention(node.source)],
        );
      }
    } else if (node.kind === "note") {
      const items = noteContextsRef.current;
      const selected = items.some((note) => note.id === node.note.id);
      if (!selected && selectedContextCount >= MAX_SOURCE_MENTIONS) {
        return;
      }
      const nextNoteContexts = selected
        ? items.filter((note) => note.id !== node.note.id)
        : [...items, node.note];
      noteContextsRef.current = nextNoteContexts;
      setNoteContexts(nextNoteContexts);
    }
    if (!options.keepOpen) {
      closeItemContextPicker();
    }
  };

  return {
    bindings: {
      activeMentionIndex: mentionPicker.activeMentionIndex,
      activeItemContextIndex: resolvedActiveItemContextIndex,
      addLocalAttachment,
      bottomDockRef,
      closeItemContextPicker,
      composerRef,
      draft,
      insertPrompt,
      itemContextExpanded: resolvedItemContextExpanded,
      itemContextLimitReached: selectedContextCount >= MAX_SOURCE_MENTIONS,
      itemContextNodes,
      itemContextPickerOpen,
      itemContextSourceId,
      itemContextTree,
      localAttachments,
      mentionCandidates: mentionPicker.mentionCandidates,
      mentions,
      noteContexts,
      moveItemContextSelection: (direction) => {
        setActiveItemContextIndex((current) =>
          moveMentionCandidateIndex(
            Math.min(current, Math.max(itemContextRowCount - 1, 0)),
            itemContextRowCount,
            direction,
          ),
        );
      },
      moveMentionSelection: mentionPicker.moveMentionSelection,
      openItemContextPicker,
      promptButtonRef,
      promptPickerOpen,
      removeLocalAttachment: (attachmentId) => {
        setLocalAttachments((items) =>
          items.filter((attachment) => attachment.id !== attachmentId),
        );
      },
      removeMention: (mentionId) => {
        const target = mentions.find((mention) => mention.id === mentionId);
        if (!target) return;
        const openTreeSource = mentions.find(
          (mention) => mention.sourceId === itemContextSourceId,
        );
        setMentions((items) =>
          items.filter((mention) => !sameItemContext(mention, target)),
        );
        const nextNoteContexts = noteContextsRef.current.filter(
          (note) => !sameItemContext(note, target),
        );
        noteContextsRef.current = nextNoteContexts;
        setNoteContexts(nextNoteContexts);
        if (openTreeSource && sameItemContext(openTreeSource, target)) {
          closeItemContextPicker();
        }
      },
      removeNoteContext: (noteId) => {
        const nextNoteContexts = noteContextsRef.current.filter(
          (note) => note.id !== noteId,
        );
        noteContextsRef.current = nextNoteContexts;
        setNoteContexts(nextNoteContexts);
      },
      selectItemContext,
      selectMention: mentionPicker.selectMention,
      setActiveItemContextIndex,
      setItemContextExpanded,
      setMentionQuery,
      setPromptPickerOpen,
      submit: () => submit(),
      textareaRef,
      updateDraft,
    },
    insertPrompt,
    submit,
  };
}

export { useComposerDraft };
