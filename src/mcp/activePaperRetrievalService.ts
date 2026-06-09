import type { PaperScope, PaperTextResult } from "../zotero/types";

export { ActivePaperRetrievalService };
export type { PaperReadRequest, PaperReadResult, PaperReadSnippet };

type PaperReadRequest = {
  question?: string;
};

type PaperReadSnippet = {
  text: string;
  source: "zotero_fulltext";
  locator: {
    chunkIndex: number;
    charStart: number;
    charEnd: number;
  };
  score: number;
};

type PaperReadResult = {
  status: "active_reader" | "no_active_reader" | "no_text";
  snippets: PaperReadSnippet[];
};

type TextChunk = {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
};

type ActivePaperRetrievalServiceOptions = {
  readPaperText: (scope: PaperScope) => Promise<PaperTextResult>;
};

const CHUNK_TARGET_LENGTH = 1800;
const CHUNK_OVERLAP = 200;
const MIN_BOUNDARY_LOOKBACK = 400;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "paper",
  "the",
  "this",
  "to",
  "what",
  "with",
]);

class ActivePaperRetrievalService {
  constructor(private readonly options: ActivePaperRetrievalServiceOptions) {}

  async read(
    scope: PaperScope | null,
    request: PaperReadRequest,
  ): Promise<PaperReadResult> {
    if (!scope) {
      return {
        status: "no_active_reader",
        snippets: [],
      };
    }

    const text = await this.options.readPaperText(scope);

    if (!text.text) {
      return {
        status: "no_text",
        snippets: [],
      };
    }

    const queryTerms = tokenize(request.question || "");
    if (!queryTerms.length) {
      return {
        status: "active_reader",
        snippets: [],
      };
    }

    const snippets = createChunks(text.text)
      .map((chunk) => scoreChunk(chunk, queryTerms))
      .filter((snippet) => snippet.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.locator.chunkIndex - right.locator.chunkIndex,
      );

    return {
      status: "active_reader",
      snippets,
    };
  }
}

function createChunks(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const targetEnd = Math.min(text.length, start + CHUNK_TARGET_LENGTH);
    const end =
      targetEnd === text.length
        ? targetEnd
        : findChunkBoundary(text, targetEnd);
    const chunkText = text.slice(start, end).trim();

    if (chunkText) {
      chunks.push({
        index: chunks.length,
        text: chunkText,
        charStart: start,
        charEnd: end,
      });
    }

    if (end >= text.length) {
      break;
    }
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

function findChunkBoundary(text: string, targetEnd: number): number {
  const min = Math.max(0, targetEnd - MIN_BOUNDARY_LOOKBACK);
  const sentenceEnd = Math.max(
    text.lastIndexOf(". ", targetEnd),
    text.lastIndexOf("? ", targetEnd),
    text.lastIndexOf("! ", targetEnd),
  );
  if (sentenceEnd >= min) {
    return sentenceEnd + 1;
  }

  const space = text.lastIndexOf(" ", targetEnd);
  return space >= min ? space : targetEnd;
}

function scoreChunk(chunk: TextChunk, queryTerms: string[]): PaperReadSnippet {
  const chunkTermCounts = countTerms(tokenize(chunk.text));
  const score = queryTerms.reduce((total, term) => {
    const count = chunkTermCounts.get(term) || 0;
    if (!count) {
      return total;
    }
    const weight = term.length >= 6 ? 2 : 1;
    return total + count * weight;
  }, 0);

  return {
    text: chunk.text,
    source: "zotero_fulltext",
    locator: {
      chunkIndex: chunk.index,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
    },
    score,
  };
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const terms: string[] = [];

  for (const match of lower.matchAll(/[\p{Script=Latin}\p{N}_-]+/gu)) {
    const term = match[0].replace(/^[-_]+|[-_]+$/g, "");
    if (term.length >= 2 && !STOP_WORDS.has(term)) {
      terms.push(term);
    }
  }

  const han = [...lower.matchAll(/\p{Script=Han}/gu)].map((match) => match[0]);
  terms.push(...han);
  for (let index = 0; index < han.length - 1; index += 1) {
    terms.push(`${han[index]}${han[index + 1]}`);
  }

  return Array.from(new Set(terms));
}

function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms) {
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return counts;
}
