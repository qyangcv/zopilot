import type { JsonValue } from "../../codex/types";
import {
  DocumentContextBuilder,
  formatContextForTool,
} from "../../document/contextBuilder";
import type { BuiltContext, WorkspaceQueryScope } from "../../document/types";
import type {
  McpTool,
  McpToolCallContext,
  McpToolCallResult,
} from "../protocol";
import { isJsonObject } from "../protocol";
import { createLogger } from "../../utils/logger";

export { createPaperReadTool };

type PaperReadInput = {
  question?: string;
};

type PaperReadToolOptions = {
  contextBuilder?: {
    build(input: {
      scope?: WorkspaceQueryScope;
      bindingError?: string;
      question?: string;
    }): Promise<BuiltContext>;
  };
  logger?: (message: string, details?: JsonValue) => void;
};

const paperReadLogger = createLogger("mcp.tools.paperRead");

function createPaperReadTool(options: PaperReadToolOptions = {}): McpTool {
  const logger = createPaperReadLogger(options.logger);
  let defaultContextBuilder: DocumentContextBuilder | undefined;
  const getContextBuilder = () => {
    if (options.contextBuilder) {
      return options.contextBuilder;
    }
    defaultContextBuilder ??= new DocumentContextBuilder();
    return defaultContextBuilder;
  };
  return {
    definition: {
      name: "paper_read",
      title: "Read Zopilot paper context",
      description:
        "Retrieve traceable evidence from the PDF material cache for the current Zopilot workspace. Returns context excerpts, document structure, locators, pages, and artifact paths; it does not answer for the agent.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: {
            type: "string",
            description:
              "The paper-specific reading question or locator intent, such as Figure 2, Table 1, page 5, a section title, or a natural-language information need.",
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
        hasWorkspaceBinding: Boolean(context.workspaceScope),
      });

      const output = await getContextBuilder().build({
        scope: context.workspaceScope,
        bindingError: context.paperBindingError,
        question: parsedInput.question,
      });
      logger.debug("mcp.tool.paper_read.finish", {
        status: output.status,
        evidenceCount: output.evidence.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        content: [
          {
            type: "text",
            text: formatContextForTool(output),
          },
        ],
        isError:
          output.status === "not_bound" ||
          output.status === "no_source" ||
          output.status === "material_error",
        _meta: {
          "zopilot.mcp.step": "v0.3.0-light.context",
          "zopilot.mcp.durationMs": Date.now() - startedAt,
        },
      };
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

function createPaperReadLogger(callback?: PaperReadToolOptions["logger"]) {
  if (callback) {
    return {
      debug: callback,
    };
  }
  return {
    debug: (message: string, details?: JsonValue) =>
      paperReadLogger.debug(message, details),
  };
}
