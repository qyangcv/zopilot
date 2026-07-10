import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LocalAttachmentRef,
  SourceMention,
} from "../../../../domain/conversation";
import type { ComposerBindings } from "../composerBindings";
import { resizeTextarea } from "../composerLayout";
import {
  buildSidebarCommands,
  filterSidebarCommands,
} from "../commandRegistry";
import type {
  SidebarActions,
  SidebarCommandView,
  SidebarState,
} from "../types";
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
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const workspaceKeyRef = useRef(state.context.workspaceKey || "");
  const [commandAnchor, setCommandAnchor] = useState<"button" | "input">(
    "input",
  );
  const bottomDockRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commandButtonRef = useRef<HTMLButtonElement | null>(null);
  const promptButtonRef = useRef<HTMLButtonElement | null>(null);
  const sourceCandidates = state.sourceCandidates || [];
  const currentSourceId = sourceCandidates.find(
    (source) => source.paperKey === state.context.paperKey,
  )?.sourceId;
  const commands = useMemo(() => buildSidebarCommands(state), [state]);
  const visibleCommands = useMemo(
    () => filterSidebarCommands(commands, commandQuery),
    [commandQuery, commands],
  );

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
    setCommandOpen(false);
    setCommandQuery("");
    setPromptPickerOpen(false);
  }, [state.context.workspaceKey]);

  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [draft, state.busy, state.composerEnabled]);

  const updateDraftWithoutMention = (text: string) => {
    setDraft(text);
    if (text.startsWith("/")) {
      setCommandAnchor("input");
      setCommandOpen(true);
      setCommandQuery(text.slice(1));
    } else {
      setCommandOpen(false);
      setCommandQuery("");
    }
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
      .then((attachment) => {
        if (!attachment) {
          return;
        }
        setLocalAttachments((items) =>
          items.some((item) => item.path === attachment.path)
            ? items
            : [...items, attachment],
        );
        globalThis.setTimeout(() => textareaRef.current?.focus(), 0);
      })
      .catch(() => undefined);
  };

  const executeCommand = (command: SidebarCommandView) => {
    if (!command.available) {
      return;
    }
    setCommandOpen(false);
    setCommandQuery("");
    if (command.id === "source.add" || command.id === "attachment.upload") {
      addLocalAttachment();
      return;
    }
    if (command.id === "session.new") {
      actions.createNewSession();
      return;
    }
    if (command.id === "session.history") {
      actions.toggleSessions();
      return;
    }
    if (command.id.startsWith("prompt.")) {
      const prompt = state.prompts.find(
        (item) => command.id === `prompt.${item.id}`,
      );
      if (prompt) {
        insertPrompt(prompt.body);
      }
    }
  };

  return {
    bindings: {
      addLocalAttachment,
      bottomDockRef,
      commandAnchor,
      commandAnchorRef:
        commandAnchor === "button" ? commandButtonRef : textareaRef,
      commandButtonRef,
      commandOpen,
      composerRef,
      draft,
      executeCommand,
      insertPrompt,
      localAttachments,
      mentionCandidates: mentionPicker.mentionCandidates,
      mentions,
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
      setCommandAnchor,
      setCommandOpen,
      setCommandQuery,
      setMentionQuery: mentionPicker.setMentionQuery,
      setPromptPickerOpen,
      submit: () => submit(),
      textareaRef,
      updateDraft,
      visibleCommands,
    },
    insertPrompt,
    submit,
  };
}

export { useComposerDraft };
export type { ComposerDraftController };
