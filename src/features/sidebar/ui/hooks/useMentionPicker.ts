import { useState } from "react";
import type { PaperSourceRef } from "../../../../domain/conversation";
import {
  findMentionQuery,
  matchMentionCandidates,
  moveMentionCandidateIndex,
} from "../mentions";

type MentionPickerOptions = {
  currentSourceId?: string;
  sourceCandidates: PaperSourceRef[];
};

function useMentionPicker(options: MentionPickerOptions) {
  const [mentionQuery, setMentionQueryState] = useState<ReturnType<
    typeof findMentionQuery
  > | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionCandidates = mentionQuery
    ? matchMentionCandidates(
        mentionQuery.query,
        options.sourceCandidates,
        options.currentSourceId,
      )
    : [];
  const resolvedActiveMentionIndex = Math.min(
    activeMentionIndex,
    Math.max(mentionCandidates.length - 1, 0),
  );

  const setMentionQuery = (
    query: ReturnType<typeof findMentionQuery> | null,
  ) => {
    setActiveMentionIndex(0);
    setMentionQueryState(query);
  };

  const moveMentionSelection = (direction: -1 | 1) => {
    setActiveMentionIndex((current) =>
      moveMentionCandidateIndex(
        Math.min(current, Math.max(mentionCandidates.length - 1, 0)),
        mentionCandidates.length,
        direction,
      ),
    );
  };

  return {
    activeMentionIndex: resolvedActiveMentionIndex,
    mentionQuery,
    mentionCandidates,
    moveMentionSelection,
    setActiveMentionIndex,
    setMentionQuery,
  };
}

export { useMentionPicker };
