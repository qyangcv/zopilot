import { ZoteroContextGateway } from "../../zotero/contextGateway";
import type { PaperScope } from "../../zotero/types";
import type { JsonValue } from "../../codex/types";
import type { JsonObject, McpTool, McpToolCallResult } from "../protocol";
import { isJsonObject } from "../protocol";

export { createPaperReadTool };
export type { PaperReadSkeletonOutput };

type PaperReadInput = {
  question?: string;
  maxChars?: number;
};

type PaperReadSkeletonOutput = {
  status: "active_reader" | "no_active_reader" | "error";
  paper: {
    attachmentItemID: number;
    parentItemID?: number;
    libraryID: number;
    readerType?: string;
  } | null;
  request: {
    question?: string;
    maxChars?: number;
  };
  warnings: string[];
};

type PaperReadToolOptions = {
  resolveActivePaper?: () => Promise<PaperScope | null>;
  logger?: (message: string, details?: JsonValue) => void;
};

const DEFAULT_MAX_CHARS = 20000;
const HARD_MAX_CHARS = 50000;

function createPaperReadTool(options: PaperReadToolOptions = {}): McpTool {
  return {
    definition: {
      name: "paper_read",
      title: "Read current Zotero paper",
      description:
        "Read-only skeleton for the currently active Zotero PDF reader paper. Step 5.1 returns scope/status only; full text is wired in Step 5.2.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: {
            type: "string",
            description: "The paper-specific reading question or intent.",
          },
          maxChars: {
            type: "integer",
            minimum: 1,
            maximum: HARD_MAX_CHARS,
            description:
              "Requested text budget. Accepted in 5.1 for compatibility; full text is not returned until 5.2.",
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
        maxChars: parsedInput.maxChars || null,
      });

      try {
        const scope = await resolveActivePaper(options);
        const output = createSkeletonOutput(scope, parsedInput);
        options.logger?.("mcp.tool.paper_read.finish", {
          status: output.status,
          hasPaper: Boolean(output.paper),
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
          isError: !scope,
          _meta: {
            "zoteroCopilot.mcp.step": "5.1",
            "zoteroCopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      } catch (error) {
        const message = `paper_read failed before reading paper scope: ${String(
          error,
        )}`;
        options.logger?.("mcp.tool.paper_read.error", {
          error: message,
          durationMs: Date.now() - startedAt,
        });
        const output: PaperReadSkeletonOutput = {
          status: "error",
          paper: null,
          request: parsedInput,
          warnings: [message],
        };
        return {
          content: [{ type: "text", text: message }],
          structuredContent: output as unknown as JsonValue,
          isError: true,
          _meta: {
            "zoteroCopilot.mcp.step": "5.1",
            "zoteroCopilot.mcp.durationMs": Date.now() - startedAt,
          },
        };
      }
    },
  };
}

function parsePaperReadInput(input: JsonValue | undefined): PaperReadInput {
  if (input === undefined || input === null) {
    return {
      maxChars: DEFAULT_MAX_CHARS,
    };
  }
  if (!isJsonObject(input)) {
    throw new Error("paper_read input must be an object.");
  }

  const allowed = new Set(["question", "maxChars"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) {
      throw new Error(`paper_read input contains unsupported field: ${key}`);
    }
  }

  const question = input.question;
  if (question !== undefined && typeof question !== "string") {
    throw new Error("paper_read.question must be a string.");
  }

  const rawMaxChars = input.maxChars;
  if (rawMaxChars !== undefined) {
    if (
      typeof rawMaxChars !== "number" ||
      !Number.isInteger(rawMaxChars) ||
      rawMaxChars < 1 ||
      rawMaxChars > HARD_MAX_CHARS
    ) {
      throw new Error(
        `paper_read.maxChars must be an integer between 1 and ${HARD_MAX_CHARS}.`,
      );
    }
  }

  return {
    question,
    maxChars: typeof rawMaxChars === "number" ? rawMaxChars : DEFAULT_MAX_CHARS,
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

function getBestZoteroWindow(): Window {
  const windows = Zotero.getMainWindows?.();
  const firstWindow = windows?.[0];
  if (firstWindow) {
    return firstWindow;
  }
  return globalThis as unknown as Window;
}

function createSkeletonOutput(
  scope: PaperScope | null,
  request: PaperReadInput,
): PaperReadSkeletonOutput {
  if (!scope) {
    return {
      status: "no_active_reader",
      paper: null,
      request,
      warnings: [
        "No active Zotero PDF reader paper was detected. Open a PDF reader tab before calling paper_read.",
      ],
    };
  }

  return {
    status: "active_reader",
    paper: {
      attachmentItemID: scope.attachmentItemID,
      parentItemID: scope.parentItemID,
      libraryID: scope.libraryID,
      readerType: scope.readerType,
    },
    request,
    warnings: [...scope.warnings],
  };
}

function formatPaperReadSummary(output: PaperReadSkeletonOutput): string {
  if (!output.paper) {
    return output.warnings.join("\n");
  }
  const details: JsonObject = {
    status: output.status,
    attachmentItemID: output.paper.attachmentItemID,
    libraryID: output.paper.libraryID,
  };
  if (output.paper.parentItemID) {
    details.parentItemID = output.paper.parentItemID;
  }
  if (output.paper.readerType) {
    details.readerType = output.paper.readerType;
  }
  return [
    "paper_read Step 5.1 skeleton is reachable.",
    `Current paper scope: ${JSON.stringify(details)}`,
    "Full text retrieval is not wired until Step 5.2.",
  ].join("\n");
}
