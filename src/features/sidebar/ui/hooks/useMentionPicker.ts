import {
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type {
  PaperSourceRef,
  SourceMention,
} from "../../../../domain/conversation";
import {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchMentionCandidates,
  sourceToMention,
} from "../mentions";

type MentionPickerOptions = {
  currentSourceId?: string;
  draft: string;
  mentions: SourceMention[];
  onDraftChange: (text: string, cursor?: number) => void;
  setMentions: Dispatch<SetStateAction<SourceMention[]>>;
  sourceCandidates: PaperSourceRef[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

function useMentionPicker(options: MentionPickerOptions) {
  const [mentionQuery, setMentionQuery] = useState<ReturnType<
    typeof findMentionQuery
  > | null>(null);
  const mentionCandidates = mentionQuery
    ? matchMentionCandidates(
        mentionQuery.query,
        options.sourceCandidates,
        options.currentSourceId,
      )
    : [];

  const updateMentionQuery = (text: string, cursor?: number) => {
    setMentionQuery(findMentionQuery(text, cursor ?? text.length));
  };

  const selectMention = (source: PaperSourceRef) => {
    if (!mentionQuery || options.mentions.length >= MAX_SOURCE_MENTIONS) {
      return;
    }
    const nextDraft =
      options.draft.slice(0, mentionQuery.start) +
      options.draft.slice(mentionQuery.end);
    const nextMentions = options.mentions.some(
      (mention) => mention.sourceId === source.sourceId,
    )
      ? options.mentions
      : [...options.mentions, sourceToMention(source)];
    options.onDraftChange(nextDraft, mentionQuery.start);
    options.setMentions(nextMentions);
    setMentionQuery(null);
    globalThis.setTimeout(() => {
      const nextCursor = mentionQuery.start;
      options.textareaRef.current?.focus();
      options.textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  return {
    mentionCandidates,
    selectMention,
    setMentionQuery,
    updateMentionQuery,
  };
}

export { useMentionPicker };
export type { MentionPickerOptions };
