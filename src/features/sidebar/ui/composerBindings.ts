import type { RefObject } from "react";
import type {
  ItemContextNode,
  ItemContextTree,
  LocalAttachmentRef,
  NoteContextRef,
  PaperSourceRef,
  SourceMention,
} from "../../../domain/conversation";
import { findMentionQuery } from "./mentions";
import type { SidebarDropPayload } from "../../../integrations/zotero/compat/dragData";

type ComposerBindings = {
  activeMentionIndex: number;
  activeItemContextIndex: number;
  addDroppedContext: (payload: SidebarDropPayload) => void;
  addLocalAttachment: () => void;
  bottomDockRef: RefObject<HTMLDivElement | null>;
  closeItemContextPicker: () => void;
  composerRef: RefObject<HTMLFormElement | null>;
  draft: string;
  insertPrompt: (
    text: string,
    mentions?: SourceMention[],
    noteContexts?: NoteContextRef[],
    attachments?: LocalAttachmentRef[],
  ) => void;
  localAttachments: LocalAttachmentRef[];
  itemContextExpanded: boolean;
  itemContextLimitReached: boolean;
  itemContextNodes: ItemContextNode[];
  itemContextPickerOpen: boolean;
  itemContextSourceId?: string;
  itemContextTree?: ItemContextTree;
  mentionCandidates: PaperSourceRef[];
  mentions: SourceMention[];
  noteContexts: NoteContextRef[];
  moveItemContextSelection: (direction: -1 | 1) => void;
  moveMentionSelection: (direction: -1 | 1) => void;
  openItemContextPicker: (source?: SourceMention) => void;
  promptButtonRef: RefObject<HTMLButtonElement | null>;
  promptPickerOpen: boolean;
  removeLocalAttachment: (attachmentId: string) => void;
  removeMention: (mentionId: string) => void;
  removeNoteContext: (noteId: string) => void;
  selectItemContext: (
    node: ItemContextNode,
    options?: { keepOpen?: boolean },
  ) => void;
  selectMention: (source: PaperSourceRef) => void;
  setActiveMentionIndex: (index: number) => void;
  setActiveItemContextIndex: (index: number) => void;
  setItemContextExpanded: (expanded: boolean) => void;
  setMentionQuery: (query: ReturnType<typeof findMentionQuery> | null) => void;
  setPromptPickerOpen: (
    open: boolean | ((current: boolean) => boolean),
  ) => void;
  submit: (
    text?: string,
    mentions?: SourceMention[],
    noteContexts?: NoteContextRef[],
    attachments?: LocalAttachmentRef[],
  ) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  updateDraft: (text: string, cursor?: number) => void;
};

export type { ComposerBindings };
