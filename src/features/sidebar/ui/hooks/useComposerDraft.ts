import { useEffect, useRef, useState } from "react";
import type {
  ItemContextNode,
  LocalAttachmentRef,
  NoteContextRef,
  SourceMention,
} from "../../../../domain/conversation";
import type { ComposerBindings } from "../composerBindings";
import { resizeTextarea } from "../composerLayout";
import type { SidebarActions, SidebarState } from "../types";
import { useMentionPicker } from "./useMentionPicker";
import {
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
  const [activeItemContextIndex, setActiveItemContextIndex] = useState(1);
  const composerScopeRef = useRef("");
  const noteContextsRef = useRef(noteContexts);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceCandidates = state.sourceCandidates || [];
  const itemContextTree = state.itemContextTree;
  const persistentNoteMode =
    state.context.hostContextKind === "reader" &&
    state.context.workspaceType === "item";
  const itemContextMode = Boolean(itemContextTree && persistentNoteMode);
  const activeNoteContextsSignature = JSON.stringify(
    state.activeNoteContexts || [],
  );
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
    const nextNoteContexts = persistentNoteMode
      ? [...(state.activeNoteContexts || [])]
      : [];
    noteContextsRef.current = nextNoteContexts;
    setNoteContexts(nextNoteContexts);
    setLocalAttachments([]);
    setPromptPickerOpen(false);
    setItemContextExpanded(true);
    setItemContextPickerRequestedOpen(false);
    setActiveItemContextIndex(1);
  }, [
    persistentNoteMode,
    state.activeNoteContexts,
    state.context.hostContextKind,
    state.context.workspaceKey,
    state.conversationId,
  ]);

  useEffect(() => {
    const nextNoteContexts = persistentNoteMode
      ? [...(state.activeNoteContexts || [])]
      : [];
    noteContextsRef.current = nextNoteContexts;
    setNoteContexts(nextNoteContexts);
  }, [activeNoteContextsSignature, persistentNoteMode, state.conversationId]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  const updateDraftWithoutMention = (text: string) => {
    setDraft(text);
  };
  const mentionPicker = useMentionPicker({
    currentSourceId,
    draft,
    mentions,
    onDraftChange: updateDraftWithoutMention,
    selectedContextCount: itemContextMode
      ? mentions.length || noteContexts.length
        ? 1
        : 0
      : mentions.length + noteContexts.length,
    setMentions,
    sourceCandidates: itemContextMode ? [] : sourceCandidates,
    textareaRef,
  });
  const itemContextPickerOpen = Boolean(
    itemContextMode &&
    (itemContextPickerRequestedOpen || mentionPicker.mentionQuery),
  );
  const catalogItemContextNodeIds = new Set(
    itemContextTree?.nodes.map((node) => node.id) || [],
  );
  const persistedUnavailableNoteNodes: ItemContextNode[] = noteContexts
    .filter((note) => !catalogItemContextNodeIds.has(note.id))
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
      ? matchItemContextNodes(mentionPicker.mentionQuery?.query || "", [
          ...itemContextTree.nodes,
          ...persistedUnavailableNoteNodes,
        ])
      : [];
  const resolvedItemContextExpanded =
    Boolean(mentionPicker.mentionQuery?.query) || itemContextExpanded;
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
    setActiveItemContextIndex(
      query && itemContextMode && itemContextTree?.nodes.length ? 1 : 0,
    );
  };
  const updateDraft = (text: string, cursor?: number) => {
    updateDraftWithoutMention(text);
    setItemContextPickerRequestedOpen(false);
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
  };

  const submit = (
    text = draft,
    nextMentions = mentions,
    nextNoteContexts?: NoteContextRef[],
    nextLocalAttachments = localAttachments,
  ) => {
    const trimmed = text.trim();
    const effectiveNoteContexts = persistentNoteMode
      ? (nextNoteContexts ?? noteContextsRef.current)
      : [];
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
    if (nextNoteContexts !== undefined && persistentNoteMode) {
      noteContextsRef.current = [...effectiveNoteContexts];
      setNoteContexts([...effectiveNoteContexts]);
      actions.updateActiveNoteContexts(effectiveNoteContexts);
    }
    actions.submitPrompt({
      text: trimmed || SELECTED_CONTEXT_PROMPT,
      mentions: nextMentions,
      noteContexts: effectiveNoteContexts,
      persistNoteContexts: persistentNoteMode,
      localAttachments: nextLocalAttachments,
    });
    setDraft("");
    setMentions([]);
    if (!persistentNoteMode) {
      noteContextsRef.current = [];
      setNoteContexts([]);
    }
    setLocalAttachments([]);
    setItemContextPickerRequestedOpen(false);
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
      const effectiveNoteContexts = persistentNoteMode
        ? [...nextNoteContexts]
        : [];
      noteContextsRef.current = effectiveNoteContexts;
      setNoteContexts(effectiveNoteContexts);
      if (persistentNoteMode) {
        actions.updateActiveNoteContexts(effectiveNoteContexts);
      }
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
    setItemContextPickerRequestedOpen(false);
    const query = mentionPicker.mentionQuery;
    if (!query) {
      setMentionQuery(null);
      return;
    }
    const nextDraft = draft.slice(0, query.start) + draft.slice(query.end);
    updateDraftWithoutMention(nextDraft);
    setMentionQuery(null);
    globalThis.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(query.start, query.start);
    }, 0);
  };

  const openItemContextPicker = () => {
    if (!itemContextMode || !itemContextTree) {
      return;
    }
    setPromptPickerOpen(false);
    setItemContextExpanded(true);
    setActiveItemContextIndex(itemContextTree.nodes.length ? 1 : 0);
    setItemContextPickerRequestedOpen(true);
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
      const nextNoteContexts = items.some((note) => note.id === node.note.id)
        ? items.filter((note) => note.id !== node.note.id)
        : [...items, node.note];
      noteContextsRef.current = nextNoteContexts;
      setNoteContexts(nextNoteContexts);
      actions.updateActiveNoteContexts(nextNoteContexts);
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
      itemContextNodes,
      itemContextPickerOpen,
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
        setMentions((items) =>
          items.filter((mention) => mention.id !== mentionId),
        );
      },
      removeNoteContext: (noteId) => {
        const nextNoteContexts = noteContextsRef.current.filter(
          (note) => note.id !== noteId,
        );
        noteContextsRef.current = nextNoteContexts;
        setNoteContexts(nextNoteContexts);
        if (persistentNoteMode) {
          actions.updateActiveNoteContexts(nextNoteContexts);
        }
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
