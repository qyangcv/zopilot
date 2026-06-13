import { ZoteroContextGateway } from "../../zotero/contextGateway";
import type { PaperScope } from "../../zotero/types";
import type { JsonValue } from "../../codex/types";
import type { McpTool, McpToolCallResult } from "../protocol";
import { isJsonObject } from "../protocol";

export { createPaperReadTool };

type PaperReadInput = {
  question?: string;
};

type PaperReadSnippet = {
  text: string;
  index: number;
  score: number;
};

type PaperReadResult = {
  status: "active_reader" | "no_active_reader" | "no_text";
  snippets: PaperReadSnippet[];
};

type TextChunk = {
  index: number;
  text: string;
};

type PaperReadToolOptions = {
  resolveActivePaper?: () => Promise<PaperScope | null>;
  readPaperText?: (scope: PaperScope) => Promise<string>;
  logger?: (message: string, details?: JsonValue) => void;
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

function createPaperReadTool(options: PaperReadToolOptions = {}): McpTool {
  return {
    definition: {
      name: "paper_read",
      title: "Read current Zotero paper",
      description:
        "Read Zotero full-text evidence snippets for the currently active PDF reader paper. Returns evidence and provenance, not a final answer.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: {
            type: "string",
            description:
              "The user's paper-specific reading question or intent. Used for lexical evidence retrieval.",
          },
        },
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async call(input: JsonValue | undefined): Promise<McpToolCallResult> {
      const startedAt = Date.now();
      const parsedInput = parsePaperReadInput(input);
      options.logger?.("mcp.tool.paper_read.start", {
        hasQuestion: Boolean(parsedInput.question),
      });

      try {
        const scope = await resolveActivePaper(options);
        const output = await readPaperEvidence(scope, parsedInput, options);
        options.logger?.("mcp.tool.paper_read.finish", {
          status: output.status,
          snippetCount: output.snippets.length,
          durationMs: Date.now() - startedAt,
        });
        return {
          content: [
            {
              type: "text",
              text: formatPaperReadSummary(output),
            },
          ],
          isError:
            output.status === "no_active_reader" || output.status === "no_text",
          _meta: {
            "zopilot.mcp.step": "5.2",
            "zopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      } catch (error) {
        const message = `paper_read failed while reading paper evidence: ${String(error)}`;
        options.logger?.("mcp.tool.paper_read.error", {
          error: message,
          durationMs: Date.now() - startedAt,
        });
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          _meta: {
            "zopilot.mcp.step": "5.2",
            "zopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      }
    },
  };
}

async function readPaperEvidence(
  scope: PaperScope | null,
  request: PaperReadInput,
  options: PaperReadToolOptions,
): Promise<PaperReadResult> {
  if (!scope) {
    return {
      status: "no_active_reader",
      snippets: [],
    };
  }

  const text = await readPaperText(options, scope);

  if (!text) {
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

  const snippets = createChunks(text)
    .map((chunk) => scoreChunk(chunk, queryTerms))
    .filter((snippet) => snippet.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );

  return {
    status: "active_reader",
    snippets,
  };
}

function parsePaperReadInput(input: JsonValue | undefined): PaperReadInput {
  if (input === undefined || input === null) {
    return {};
  }
  if (!isJsonObject(input)) {
    throw new Error("paper_read input must be an object.");
  }

  for (const key of Object.keys(input)) {
    if (key !== "question") {
      throw new Error(`paper_read input contains unsupported field: ${key}`);
    }
  }

  const question = input.question;
  if (question !== undefined && typeof question !== "string") {
    throw new Error("paper_read.question must be a string.");
  }
  return {
    question,
  };
}

async function resolveActivePaper(
  options: PaperReadToolOptions,
): Promise<PaperScope | null> {
  if (options.resolveActivePaper) {
    return options.resolveActivePaper();
  }
  const win = getBestZoteroWindow();
  return new ZoteroContextGateway(win).getActivePaper();
}

async function readPaperText(
  options: PaperReadToolOptions,
  scope: PaperScope,
): Promise<string> {
  if (options.readPaperText) {
    return options.readPaperText(scope);
  }
  const win = getBestZoteroWindow();
  return new ZoteroContextGateway(win).getAttachmentFullTextForTool(scope);
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
    index: chunk.index,
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

function getBestZoteroWindow(): Window {
  const windows = Zotero.getMainWindows?.();
  const firstWindow = windows?.[0];
  if (!firstWindow) {
    throw new Error("No Zotero main window is available.");
  }
  return firstWindow;
}

function formatPaperReadSummary(output: PaperReadResult): string {
  if (output.snippets.length) {
    return output.snippets.map((snippet) => snippet.text).join("\n\n---\n\n");
  }

  if (output.status === "no_active_reader") {
    return "No active Zotero PDF reader paper is available.";
  }

  if (output.status === "no_text") {
    return "The current PDF has no readable Zotero full text.";
  }

  return "No relevant text was found.";
}
