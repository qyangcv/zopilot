import {
  ActivePaperRetrievalService,
  type PaperReadEvidenceOutput,
} from "../activePaperRetrievalService";
import { ZoteroContextGateway } from "../../zotero/contextGateway";
import type { PaperScope, PaperTextResult } from "../../zotero/types";
import type { JsonValue } from "../../codex/types";
import type { McpTool, McpToolCallResult } from "../protocol";
import { isJsonObject } from "../protocol";

export { createPaperReadTool };
export type { PaperReadEvidenceOutput };

type PaperReadInput = {
  question?: string;
};

type PaperReadToolOptions = {
  resolveActivePaper?: () => Promise<PaperScope | null>;
  readPaperText?: (scope: PaperScope) => Promise<PaperTextResult>;
  logger?: (message: string, details?: JsonValue) => void;
};

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
        const output = await new ActivePaperRetrievalService({
          readPaperText: (paperScope) => readPaperText(options, paperScope),
        }).read(scope, parsedInput);
        options.logger?.("mcp.tool.paper_read.finish", {
          status: output.status,
          hasPaper: Boolean(output.paper),
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
          structuredContent: output as unknown as JsonValue,
          isError:
            output.status === "no_active_reader" ||
            output.status === "no_text" ||
            output.status === "error",
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
        const output: PaperReadEvidenceOutput = {
          status: "error",
          paper: null,
          request: parsedInput,
          text: null,
          snippets: [],
          warnings: [message],
        };
        return {
          content: [{ type: "text", text: message }],
          structuredContent: output as unknown as JsonValue,
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

  const allowed = new Set(["question"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
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

function formatPaperReadSummary(output: PaperReadEvidenceOutput): string {
  if (!output.paper) {
    return output.warnings.join("\n");
  }
  const lines = [
    `paper_read returned ${output.snippets.length} Zotero full-text snippet(s).`,
    `Current paper scope: ${JSON.stringify(output.paper)}`,
  ];

  if (output.text) {
    lines.push(
      `Full-text status: ${output.text.status}; length: ${output.text.length}`,
    );
  }
  if (output.warnings.length) {
    lines.push(
      "Warnings:",
      ...output.warnings.map((warning) => `- ${warning}`),
    );
  }
  output.snippets.forEach((snippet, index) => {
    lines.push(
      "",
      `[snippet ${index + 1}; chunk ${snippet.locator.chunkIndex}; chars ${snippet.locator.charStart}-${snippet.locator.charEnd}; score ${snippet.score}]`,
      snippet.text,
    );
  });
  return lines.join("\n");
}
