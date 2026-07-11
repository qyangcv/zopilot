import type { RefObject } from "react";
import type {
  LocalAttachmentRef,
  PaperSourceRef,
  SourceMention,
} from "../../../domain/conversation";
import { findMentionQuery } from "./mentions";

type ComposerBindings = {
  activeMentionIndex: number;
  addLocalAttachment: () => void;
  bottomDockRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLFormElement | null>;
  draft: string;
  insertPrompt: (text: string) => void;
  localAttachments: LocalAttachmentRef[];
  mentionCandidates: PaperSourceRef[];
  mentions: SourceMention[];
  moveMentionSelection: (direction: -1 | 1) => void;
  promptButtonRef: RefObject<HTMLButtonElement | null>;
  promptPickerOpen: boolean;
  removeLocalAttachment: (attachmentId: string) => void;
  removeMention: (mentionId: string) => void;
  selectMention: (source: PaperSourceRef) => void;
  setMentionQuery: (query: ReturnType<typeof findMentionQuery> | null) => void;
  setPromptPickerOpen: (
    open: boolean | ((current: boolean) => boolean),
  ) => void;
  submit: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  updateDraft: (text: string, cursor?: number) => void;
};

export type { ComposerBindings };
