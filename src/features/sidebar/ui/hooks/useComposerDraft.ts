import { useEffect, useRef, useState } from "react";
import type {
  LocalAttachmentRef,
  SourceMention,
} from "../../../../domain/conversation";
import type { ComposerBindings } from "../composerBindings";
import { resizeTextarea } from "../composerLayout";
import type { SidebarActions, SidebarState } from "../types";
import { useMentionPicker } from "./useMentionPicker";

const SELECTED_CONTEXT_PROMPT = "Use the selected context.";

type ComposerDraftController = {
  bindings: ComposerBindings;
  insertPrompt: (
    text: string,
    mentions?: SourceMention[],
    attachments?: LocalAttachmentRef[],
  ) => void;
  submit: (
    text?: string,
    mentions?: SourceMention[],
    attachments?: LocalAttachmentRef[],
  ) => void;
};

function useComposerDraft(
  actions: SidebarActions,
  state: SidebarState,
): ComposerDraftController {
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SourceMention[]>([]);
  const [localAttachments, setLocalAttachments] = useState<
    LocalAttachmentRef[]
  >([]);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const workspaceKeyRef = useRef(state.context.workspaceKey || "");
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceCandidates = state.sourceCandidates || [];
  const currentSourceId = sourceCandidates.find(
    (source) => source.paperKey === state.context.paperKey,
  )?.sourceId;

  useEffect(() => {
    textareaRef.current?.focus();
  }, [state.focusToken]);

  useEffect(() => {
    const workspaceKey = state.context.workspaceKey || "";
    if (workspaceKeyRef.current === workspaceKey) return;
    workspaceKeyRef.current = workspaceKey;
    setDraft("");
    setMentions([]);
    setLocalAttachments([]);
    setPromptPickerOpen(false);
  }, [state.context.workspaceKey]);

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
    setMentions,
    sourceCandidates,
    textareaRef,
  });
  const updateDraft = (text: string, cursor?: number) => {
    updateDraftWithoutMention(text);
    mentionPicker.updateMentionQuery(text, cursor);
  };

  const submit = (
    text = draft,
    nextMentions = mentions,
    nextLocalAttachments = localAttachments,
  ) => {
    const trimmed = text.trim();
    if (
      (!trimmed && !nextMentions.length && !nextLocalAttachments.length) ||
      state.busy ||
      !state.composerEnabled
    ) {
      return;
    }
    actions.submitPrompt({
      text: trimmed || SELECTED_CONTEXT_PROMPT,
      mentions: nextMentions,
      localAttachments: nextLocalAttachments,
    });
    setDraft("");
    setMentions([]);
    setLocalAttachments([]);
    mentionPicker.setMentionQuery(null);
  };

  const insertPrompt = (
    text: string,
    nextMentions: SourceMention[] = [],
    nextLocalAttachments: LocalAttachmentRef[] = [],
  ) => {
    setMentions([...nextMentions]);
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

  return {
    bindings: {
      activeMentionIndex: mentionPicker.activeMentionIndex,
      addLocalAttachment,
      bottomDockRef,
      composerRef,
      draft,
      insertPrompt,
      localAttachments,
      mentionCandidates: mentionPicker.mentionCandidates,
      mentions,
      moveMentionSelection: mentionPicker.moveMentionSelection,
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
      selectMention: mentionPicker.selectMention,
      setMentionQuery: mentionPicker.setMentionQuery,
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
export type { ComposerDraftController };
