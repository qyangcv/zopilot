import type { PaperScope } from "../../zotero/types";
import type { JsonValue } from "../../codex/types";
import type {
  McpTool,
  McpToolCallContext,
  McpToolCallResult,
} from "../protocol";
import { isJsonObject } from "../protocol";
import { PAPER_BINDING_MISSING_MESSAGE } from "../paperBinding";
import { createLogger } from "../../utils/logger";

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
  status: "bound_paper" | "not_bound" | "no_text";
  snippets: PaperReadSnippet[];
  error?: string;
};

type TextChunk = {
  index: number;
  text: string;
};

type PaperReadToolOptions = {
  readPaperText?: (scope: PaperScope) => Promise<string>;
  logger?: (message: string, details?: JsonValue) => void;
};

const paperReadLogger = createLogger("mcp.tools.paperRead");

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
  const logger = createPaperReadLogger(options.logger);
  return {
    definition: {
      name: "paper_read",
      title: "Read bound Zotero paper",
      description:
        "Read Zotero full-text evidence snippets for the PDF bound to this Zopilot conversation. Returns evidence and provenance, not a final answer.",
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
    async call(
      input: JsonValue | undefined,
      context: McpToolCallContext,
    ): Promise<McpToolCallResult> {
      const startedAt = Date.now();
      const parsedInput = parsePaperReadInput(input);
      logger.debug("mcp.tool.paper_read.start", {
        hasQuestion: Boolean(parsedInput.question),
        hasPaperBinding: Boolean(context.paperScope),
      });

      try {
        const output = await readPaperEvidence(
          context.paperScope,
          context.paperBindingError,
          parsedInput,
          options,
        );
        logger.debug("mcp.tool.paper_read.finish", {
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
          isError: output.status === "not_bound" || output.status === "no_text",
          _meta: {
            "zopilot.mcp.step": "5.2",
            "zopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      } catch (error) {
        const message = `paper_read failed while reading paper evidence: ${String(error)}`;
        logger.error("mcp.tool.paper_read.error", error, {
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

function createPaperReadLogger(callback?: PaperReadToolOptions["logger"]) {
  if (callback) {
    return {
      debug: callback,
      error(message: string, error: unknown, details?: JsonValue): void {
        callback(message, mergeErrorDetails(error, details));
      },
    };
  }
  return {
    debug: (message: string, details?: JsonValue) =>
      paperReadLogger.debug(message, details),
    error: (message: string, error: unknown, details?: JsonValue) =>
      paperReadLogger.error(message, error, details),
  };
}

function mergeErrorDetails(error: unknown, details?: JsonValue): JsonValue {
  const payload: { [key: string]: JsonValue } = {
    error: String(error),
  };
  if (details && typeof details === "object" && !Array.isArray(details)) {
    return {
      ...details,
      error: payload.error,
    };
  }
  if (details !== undefined) {
    payload.details = details;
  }
  return payload;
}

async function readPaperEvidence(
  scope: PaperScope | undefined,
  bindingError: string | undefined,
  request: PaperReadInput,
  options: PaperReadToolOptions,
): Promise<PaperReadResult> {
  if (!scope) {
    return {
      status: "not_bound",
      snippets: [],
      error: bindingError || PAPER_BINDING_MISSING_MESSAGE,
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
      status: "bound_paper",
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
    status: "bound_paper",
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

async function readPaperText(
  options: PaperReadToolOptions,
  scope: PaperScope,
): Promise<string> {
  if (options.readPaperText) {
    return options.readPaperText(scope);
  }
  const attachment = Zotero.Items.get(scope.attachmentItemID);
  if (!attachment?.isAttachment?.() || !attachment.isPDFAttachment?.()) {
    return "";
  }
  if (
    attachment.key !== scope.attachmentKey ||
    attachment.libraryID !== scope.libraryID
  ) {
    throw new Error("Bound Zotero attachment no longer matches this thread.");
  }
  return normalizeText((await attachment.attachmentText) || "");
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

function formatPaperReadSummary(output: PaperReadResult): string {
  if (output.snippets.length) {
    return output.snippets.map((snippet) => snippet.text).join("\n\n---\n\n");
  }

  if (output.status === "not_bound") {
    return output.error || PAPER_BINDING_MISSING_MESSAGE;
  }

  if (output.status === "no_text") {
    return "The bound PDF has no readable Zotero full text.";
  }

  return "No relevant text was found.";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
