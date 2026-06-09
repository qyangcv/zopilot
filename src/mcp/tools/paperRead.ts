import {
  ActivePaperRetrievalService,
  type PaperReadResult,
} from "../activePaperRetrievalService";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import type { PaperScope, PaperTextResult } from "../../zotero/types";
import type { JsonValue } from "../../codex/types";
import type { McpTool, McpToolCallResult } from "../protocol";
import { isJsonObject } from "../protocol";

export { createPaperReadTool };
export type { PaperReadResult };

type PaperReadInput = {
  question?: string;
};

type PaperReadToolOptions = {
  resolveActivePaper?: () => Promise<PaperScope | null>;
  readPaperText?: (scope: PaperScope) => Promise<PaperTextResult>;
  logger?: (message: string, details?: JsonValue) => void;
};

function createPaperReadTool(options: PaperReadToolOptions = {}): McpTool {
  const retrievalService = new ActivePaperRetrievalService({
    readPaperText: (paperScope) => readPaperText(options, paperScope),
  });

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
        const output = await retrievalService.read(scope, parsedInput);
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
            "zoteroCopilot.mcp.step": "5.2",
            "zoteroCopilot.mcp.durationMs": Date.now() - startedAt,
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
            "zoteroCopilot.mcp.step": "5.2",
            "zoteroCopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      }
    },
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
): Promise<PaperTextResult> {
  if (options.readPaperText) {
    return options.readPaperText(scope);
  }
  const win = getBestZoteroWindow();
  return new ZoteroContextGateway(win).getAttachmentFullTextForTool(scope);
}

function getBestZoteroWindow(): Window {
  const windows = Zotero.getMainWindows?.();
  const firstWindow = windows?.[0];
  if (firstWindow) {
    return firstWindow;
  }
  return globalThis as unknown as Window;
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
