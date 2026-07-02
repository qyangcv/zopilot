import type {
  PaperSourceRef,
  SourceMention,
} from "../../../shared/conversation";

export {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchMentionCandidates,
  sourceToMention,
};

const MAX_SOURCE_MENTIONS = 5;
const MENTION_TERMINATORS = new Set([
  "\n",
  "\r",
  ",",
  ".",
  ";",
  ":",
  "，",
  "。",
  "；",
  "：",
  "!",
  "?",
  "！",
  "？",
  "(",
  ")",
  "（",
  "）",
  "[",
  "]",
  "{",
  "}",
]);

type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

function findMentionQuery(text: string, cursor: number): MentionQuery | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  for (let index = end - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === "@") {
      const before = index > 0 ? text[index - 1] : "";
      if (before && /[\p{L}\p{N}_-]/u.test(before)) {
        return null;
      }
      return {
        start: index,
        end,
        query: text.slice(index + 1, end),
      };
    }
    if (MENTION_TERMINATORS.has(char)) {
      return null;
    }
  }
  return null;
}

function matchMentionCandidates(
  query: string,
  sources: PaperSourceRef[],
  currentSourceId?: string,
): PaperSourceRef[] {
  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery);
  return sources
    .map((source) => ({
      source,
      score: scoreSource(source, normalizedQuery, queryTokens, currentSourceId),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.source.title.localeCompare(right.source.title),
    )
    .map((item) => item.source);
}

function sourceToMention(source: PaperSourceRef): SourceMention {
  return {
    id: `mention-${source.sourceId}-${Date.now().toString(36)}`,
    sourceId: source.sourceId,
    paperKey: source.paperKey,
    libraryID: source.libraryID,
    parentItemID: source.parentItemID,
    parentItemKey: source.parentItemKey,
    attachmentItemID: source.attachmentItemID,
    attachmentKey: source.attachmentKey,
    title: source.title,
  };
}

function scoreSource(
  source: PaperSourceRef,
  normalizedQuery: string,
  queryTokens: string[],
  currentSourceId?: string,
): number {
  const title = normalize(source.title);
  const searchable = normalize(
    [source.title, source.year, ...(source.creators || [])].join(" "),
  );
  const boost = source.sourceId === currentSourceId ? 0.25 : 0;
  if (!normalizedQuery) {
    return 1 + boost;
  }
  if (title === normalizedQuery) {
    return 100 + boost;
  }
  if (title.startsWith(normalizedQuery)) {
    return 80 + boost;
  }
  if (tokenize(title).some((token) => token.startsWith(normalizedQuery))) {
    return 65 + boost;
  }
  if (searchable.includes(normalizedQuery)) {
    return 45 + boost;
  }
  if (
    queryTokens.length > 1 &&
    queryTokens.every((token) => searchable.includes(token))
  ) {
    return 30 + boost;
  }
  return 0;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}
