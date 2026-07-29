import { useEffect, useRef, useState, type RefCallback } from "react";
import type {
  ItemContextNode,
  ItemContextTree,
  LocalAttachmentRef,
  NoteContextRef,
  PaperSourceRef,
  SourceMention,
} from "../../../../domain/conversation";
import { MAX_SELECTED_CONTEXTS } from "../../../../domain/contextSelection";
import { findPopupNextIndex } from "../../../../ui/primitives/index";
import type { ComposerBindings } from "../composerBindings";
import type { SidebarActions, SidebarState } from "../types";
import { countItemContextSelections } from "../itemContextGroups";
import { useMentionPicker } from "./useMentionPicker";
import { findMentionQuery, sourceToMention } from "../mentions";
import type { SidebarDropPayload } from "../../../../integrations/zotero/compat/dragData";
import {
  mergeDroppedContext,
  removeMentionFromComposerContext,
} from "../droppedContext";
import { ComposerTextSession } from "../composerDraftText";
import { createTimestampId } from "../../../../runtime/ids/timestampId";

const SELECTED_CONTEXT_PROMPT = "Use the selected context.";

type ComposerDraftController = {
  bindings: ComposerBindings;
  restoreDraft: (
    text: string,
    mentions: SourceMention[],
    noteContexts: NoteContextRef[],
    attachments: LocalAttachmentRef[],
  ) => void;
  submit: (
    text?: string,
    mentions?: SourceMention[],
    noteContexts?: NoteContextRef[],
    attachments?: LocalAttachmentRef[],
  ) => void;
};

type ItemContextPickerState =
  | { kind: "closed" }
  | { kind: "workspace" }
  | { kind: "source"; sourceId: string; tree?: ItemContextTree };

type PendingComposerSubmission = {
  id: string;
  sourceText: string;
  mentions: SourceMention[];
  noteContexts: NoteContextRef[];
  localAttachments: LocalAttachmentRef[];
};

function useComposerDraft(
  actions: SidebarActions,
  state: SidebarState,
): ComposerDraftController {
  const [hasDraftText, setHasDraftText] = useState(false);
  const [mentions, setMentions] = useState<SourceMention[]>([]);
  const [noteContexts, setNoteContexts] = useState<NoteContextRef[]>([]);
  const [localAttachments, setLocalAttachments] = useState<
    LocalAttachmentRef[]
  >([]);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [itemContextExpanded, setItemContextExpanded] = useState(true);
  const [itemContextPicker, setItemContextPicker] =
    useState<ItemContextPickerState>({ kind: "closed" });
  const [activeItemContextIndex, setActiveItemContextIndex] = useState(1);
  const composerScopeRef = useRef("");
  const activeComposerScopeRef = useRef("");
  const itemContextLoadTokenRef = useRef(0);
  const mentionsRef = useRef(mentions);
  const noteContextsRef = useRef(noteContexts);
  const localAttachmentsRef = useRef(localAttachments);
  const pendingSubmissionRef = useRef<PendingComposerSubmission | undefined>(
    undefined,
  );
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaCallbackRef = useRef<RefCallback<HTMLTextAreaElement> | null>(
    null,
  );
  textareaCallbackRef.current ??= (element) => {
    textareaRef.current = element;
    if (!element) return;
    return () => {
      element.blur();
      if (textareaRef.current === element) textareaRef.current = null;
    };
  };
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const draftPublisherRef = useRef<(text: string, cursor: number) => void>(
    () => undefined,
  );
  const textSessionRef = useRef<ComposerTextSession | null>(null);
  textSessionRef.current ??= new ComposerTextSession({
    getControl: () => textareaRef.current,
    onTextChange: (text, cursor) => draftPublisherRef.current(text, cursor),
  });
  const textSession = textSessionRef.current;
  const sourceCandidates = state.sourceCandidates;
  const mentionSourceCandidates =
    state.context.workspaceType === "item" ? [] : sourceCandidates;
  const workspaceItemContextTree = state.itemContextTree;
  const readerItemContextMode =
    state.context.hostContextKind === "reader" &&
    state.context.workspaceType === "item";
  const itemContextSourceId =
    itemContextPicker.kind === "source"
      ? itemContextPicker.sourceId
      : undefined;
  const itemContextTree =
    itemContextPicker.kind === "workspace"
      ? workspaceItemContextTree
      : itemContextPicker.kind === "source"
        ? itemContextPicker.tree
        : undefined;
  noteContextsRef.current = noteContexts;
  mentionsRef.current = mentions;
  localAttachmentsRef.current = localAttachments;
  const composerScope = [
    state.context.hostContextKind || "",
    state.context.workspaceKey || "",
    state.conversationId || "",
  ].join(":");
  activeComposerScopeRef.current = composerScope;
  const currentSourceId = sourceCandidates.find(
    (source) => source.paperKey === state.context.paperKey,
  )?.sourceId;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    if (composerScopeRef.current === composerScope) return;
    const initialScope = !composerScopeRef.current;
    composerScopeRef.current = composerScope;
    pendingSubmissionRef.current = undefined;
    if (initialScope) {
      setHasDraftText(false);
    } else {
      textSession.replaceAll("", { refocus: false });
      setHasDraftText(false);
    }
    mentionsRef.current = [];
    setMentions([]);
    const nextNoteContexts: NoteContextRef[] = [];
    noteContextsRef.current = nextNoteContexts;
    setNoteContexts(nextNoteContexts);
    localAttachmentsRef.current = [];
    setLocalAttachments([]);
    setPromptPickerOpen(false);
    setItemContextExpanded(true);
    setItemContextPicker({ kind: "closed" });
    itemContextLoadTokenRef.current += 1;
    setActiveItemContextIndex(1);
  }, [composerScope, textSession]);

  useEffect(() => {
    return () => textSession.cancelPending();
  }, [textSession]);

  const selectedContextCount = countItemContextSelections(
    mentions,
    noteContexts,
    Boolean(readerItemContextMode && state.context.attachmentKey),
  );
  const mentionPicker = useMentionPicker({
    currentSourceId,
    sourceCandidates: mentionSourceCandidates,
  });
  const itemContextPickerOpen = Boolean(itemContextTree);
  const catalogItemContextNodeIds = new Set(
    itemContextTree?.nodes.map((node) => node.id) || [],
  );
  const unavailableSelectedNoteNodes: ItemContextNode[] = noteContexts
    .filter(
      (note) =>
        Boolean(note.parentItemKey) &&
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
      ? [...itemContextTree.nodes, ...unavailableSelectedNoteNodes]
      : [];
  const itemContextRowCount = itemContextExpanded
    ? itemContextNodes.length + 1
    : 1;
  const resolvedActiveItemContextIndex = Math.min(
    activeItemContextIndex,
    Math.max(itemContextRowCount - 1, 0),
  );
  const isItemContextRowDisabled = (index: number) => {
    if (index === 0) return false;
    const node = itemContextNodes[index - 1];
    if (!node?.selectable) return true;
    const selected =
      (node.kind === "pdf" &&
        (node.current ||
          mentions.some(
            (mention) => mention.sourceId === node.source.sourceId,
          ))) ||
      (node.kind === "note" &&
        noteContexts.some((note) => note.id === node.note.id));
    return selectedContextCount >= MAX_SELECTED_CONTEXTS && !selected;
  };
  const setMentionQuery = mentionPicker.setMentionQuery;
  const updateDraft = (text: string, cursor?: number) => {
    setHasDraftText(Boolean(text.trim()));
    itemContextLoadTokenRef.current += 1;
    setItemContextPicker((current) =>
      current.kind === "closed" ? current : { kind: "closed" },
    );
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
  };
  draftPublisherRef.current = (text, cursor) => updateDraft(text, cursor);

  useEffect(() => {
    const result = state.submissionResult;
    const pending = pendingSubmissionRef.current;
    if (!result || !pending || result.id !== pending.id) return;
    pendingSubmissionRef.current = undefined;
    if (
      result.status !== "accepted" ||
      textSession.read().text !== pending.sourceText ||
      !hasSameIds(mentionsRef.current, pending.mentions) ||
      !hasSameIds(noteContextsRef.current, pending.noteContexts) ||
      !hasSameIds(localAttachmentsRef.current, pending.localAttachments)
    ) {
      return;
    }
    textSession.replaceAll("", { refocus: false });
    setHasDraftText(false);
    mentionsRef.current = [];
    setMentions([]);
    noteContextsRef.current = [];
    setNoteContexts([]);
    localAttachmentsRef.current = [];
    setLocalAttachments([]);
    itemContextLoadTokenRef.current += 1;
    setItemContextPicker({ kind: "closed" });
    setMentionQuery(null);
  }, [setMentionQuery, state.submissionResult, textSession]);

  const submit = (
    text?: string,
    nextMentions = mentions,
    nextNoteContexts?: NoteContextRef[],
    nextLocalAttachments = localAttachments,
  ) => {
    const sourceText = text ?? textSession.read().text;
    const trimmed = sourceText.trim();
    const effectiveNoteContexts = nextNoteContexts ?? noteContextsRef.current;
    if (
      (!trimmed &&
        !nextMentions.length &&
        !effectiveNoteContexts.length &&
        !nextLocalAttachments.length) ||
      state.busy ||
      pendingSubmissionRef.current ||
      !state.composerEnabled
    ) {
      return;
    }
    if (nextNoteContexts !== undefined) {
      noteContextsRef.current = [...effectiveNoteContexts];
      setNoteContexts([...effectiveNoteContexts]);
    }
    const submittedMentions = [...nextMentions];
    const submittedNoteContexts = [...effectiveNoteContexts];
    const submittedLocalAttachments = [...nextLocalAttachments];
    const id = createTimestampId("submission");
    pendingSubmissionRef.current = {
      id,
      sourceText,
      mentions: submittedMentions,
      noteContexts: submittedNoteContexts,
      localAttachments: submittedLocalAttachments,
    };
    actions.submitPrompt({
      id,
      text: trimmed || SELECTED_CONTEXT_PROMPT,
      mentions: submittedMentions,
      noteContexts: submittedNoteContexts,
      localAttachments: submittedLocalAttachments,
    });
  };

  const replaceDraftText = (text: string, cursor = text.length) => {
    textSession.replaceAll(text, { cursor, refocus: true });
  };

  const insertPrompt = (text: string) => {
    textSession.insert(text, { refocus: true });
  };

  const selectMention = (source: PaperSourceRef) => {
    if (selectedContextCount >= MAX_SELECTED_CONTEXTS) return;
    const editor = textSession.read();
    const query = findMentionQuery(editor.text, editor.start);
    if (!query) {
      setMentionQuery(null);
      return;
    }
    const nextMentions = mentions.some(
      (mention) => mention.sourceId === source.sourceId,
    )
      ? mentions
      : [...mentions, sourceToMention(source)];
    textSession.replaceRange(query.start, query.end, "", {
      cursor: query.start,
      refocus: true,
    });
    mentionsRef.current = nextMentions;
    setMentions(nextMentions);
    setMentionQuery(null);
  };

  const restoreDraft = (
    text: string,
    nextMentions: SourceMention[],
    nextNoteContexts: NoteContextRef[],
    nextLocalAttachments: LocalAttachmentRef[],
  ) => {
    mentionsRef.current = [...nextMentions];
    noteContextsRef.current = [...nextNoteContexts];
    localAttachmentsRef.current = [...nextLocalAttachments];
    setMentions([...nextMentions]);
    setNoteContexts([...nextNoteContexts]);
    setLocalAttachments([...nextLocalAttachments]);
    replaceDraftText(text);
  };

  const addLocalAttachment = () => {
    void actions
      .uploadAttachment()
      .then((attachments) => {
        if (!attachments.length) {
          return;
        }
        const next = mergeDroppedContext(
          {
            mentions: mentionsRef.current,
            noteContexts: noteContextsRef.current,
            localAttachments: localAttachmentsRef.current,
          },
          attachments.map((attachment) => ({
            kind: "local-attachment" as const,
            attachment,
          })),
        );
        localAttachmentsRef.current = next.localAttachments;
        setLocalAttachments(next.localAttachments);
        globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch(() => undefined);
  };

  const addDroppedContext = (payload: SidebarDropPayload) => {
    const workspaceKey = state.context.workspaceKey;
    if (
      !workspaceKey ||
      state.context.hostContextKind !== "library" ||
      !state.composerEnabled
    ) {
      return;
    }
    const scope = activeComposerScopeRef.current;
    void actions
      .resolveDroppedContext({ payload, workspaceKey })
      .then((candidates) => {
        if (
          scope !== activeComposerScopeRef.current ||
          workspaceKey !== state.context.workspaceKey
        ) {
          return;
        }
        const next = mergeDroppedContext(
          {
            mentions: mentionsRef.current,
            noteContexts: noteContextsRef.current,
            localAttachments: localAttachmentsRef.current,
          },
          candidates,
        );
        mentionsRef.current = next.mentions;
        noteContextsRef.current = next.noteContexts;
        localAttachmentsRef.current = next.localAttachments;
        setMentions(next.mentions);
        setNoteContexts(next.noteContexts);
        setLocalAttachments(next.localAttachments);
        itemContextLoadTokenRef.current += 1;
        setItemContextPicker({ kind: "closed" });
        setMentionQuery(null);
        setPromptPickerOpen(false);
        globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch(() => undefined);
  };

  const closeItemContextPicker = () => {
    itemContextLoadTokenRef.current += 1;
    setItemContextPicker({ kind: "closed" });
    globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const openItemContextPicker = (source?: SourceMention) => {
    setPromptPickerOpen(false);
    setMentionQuery(null);
    setItemContextExpanded(true);
    setActiveItemContextIndex(1);
    if (!source) {
      itemContextLoadTokenRef.current += 1;
      setItemContextPicker(
        workspaceItemContextTree ? { kind: "workspace" } : { kind: "closed" },
      );
      globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    const token = ++itemContextLoadTokenRef.current;
    setItemContextPicker({ kind: "source", sourceId: source.sourceId });
    void actions
      .getItemContextTree(source)
      .then((tree) => {
        if (token !== itemContextLoadTokenRef.current) return;
        if (!tree) {
          setItemContextPicker({ kind: "closed" });
          return;
        }
        setItemContextPicker({
          kind: "source",
          sourceId: source.sourceId,
          tree,
        });
        setActiveItemContextIndex(tree.nodes.length ? 1 : 0);
      })
      .catch(() => {
        if (token !== itemContextLoadTokenRef.current) return;
        setItemContextPicker({ kind: "closed" });
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
        if (!selected && selectedContextCount >= MAX_SELECTED_CONTEXTS) {
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
      if (!selected && selectedContextCount >= MAX_SELECTED_CONTEXTS) {
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
      addDroppedContext,
      addLocalAttachment,
      bottomDockRef,
      closeItemContextPicker,
      composerRef,
      hasDraftText,
      insertPrompt,
      itemContextExpanded,
      itemContextLimitReached: selectedContextCount >= MAX_SELECTED_CONTEXTS,
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
          findPopupNextIndex(
            itemContextRowCount,
            Math.min(current, Math.max(itemContextRowCount - 1, 0)),
            direction,
            isItemContextRowDisabled,
          ),
        );
      },
      moveMentionSelection: mentionPicker.moveMentionSelection,
      openItemContextPicker,
      promptButtonRef,
      promptPickerOpen,
      removeLocalAttachment: (attachmentId) => {
        const next = localAttachmentsRef.current.filter(
          (attachment) => attachment.id !== attachmentId,
        );
        localAttachmentsRef.current = next;
        setLocalAttachments(next);
      },
      removeMention: (mentionId) => {
        const target = mentionsRef.current.find(
          (mention) => mention.id === mentionId,
        );
        if (!target) return;
        const next = removeMentionFromComposerContext(
          {
            mentions: mentionsRef.current,
            noteContexts: noteContextsRef.current,
            localAttachments: localAttachmentsRef.current,
          },
          mentionId,
        );
        mentionsRef.current = next.mentions;
        setMentions(next.mentions);
        if (itemContextSourceId === target.sourceId) {
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
      selectMention,
      setActiveMentionIndex: mentionPicker.setActiveMentionIndex,
      setActiveItemContextIndex,
      setItemContextExpanded,
      setMentionQuery,
      setPromptPickerOpen,
      submit: () => submit(),
      textareaCallbackRef: textareaCallbackRef.current,
      textareaRef,
      handleEditorBlur: () => textSession.handleBlur(),
      handleEditorCompositionEnd: (textarea) =>
        textSession.handleCompositionEnd(textarea),
      handleEditorCompositionStart: () => textSession.handleCompositionStart(),
      handleEditorInput: (textarea) => textSession.handleNativeInput(textarea),
    },
    restoreDraft,
    submit,
  };
}

export { useComposerDraft };

function hasSameIds(
  current: Array<{ id: string }>,
  submitted: Array<{ id: string }>,
): boolean {
  return (
    current.length === submitted.length &&
    current.every((item, index) => item.id === submitted[index]?.id)
  );
}
