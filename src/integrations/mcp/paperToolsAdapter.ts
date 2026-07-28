import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GET_OUTLINE_TOOL_DEFINITION,
  READ_TOOL_DEFINITION,
  SEARCH_TOOL_DEFINITION,
  VIEW_PAGE_TOOL_DEFINITION,
} from "../../application/document/PaperTools";
import { PaperToolsService } from "../../application/document/PaperToolsService";
import { PaperToolError } from "../../application/document/PaperMaterialResolver";
import { geckoIO } from "../../platform/gecko";
import { createLogger } from "../../runtime/logging/logger";
import {
  parseMcpClientCapabilities,
  parsePaperBindingHeaders,
} from "./workspaceBinding";

export { registerPaperTools };
export type { RegisterPaperToolsOptions };

type RegisterPaperToolsOptions = {
  service?: PaperToolsService;
  readFile?: (path: string) => Promise<Uint8Array>;
};

const logger = createLogger("mcp.paperTools");

function registerPaperTools(
  server: McpServer,
  options: RegisterPaperToolsOptions = {},
): void {
  const service = options.service || new PaperToolsService();
  const readFile = options.readFile || ((path) => geckoIO.read(path));

  {
    const { name, ...definition } = GET_OUTLINE_TOOL_DEFINITION;
    server.registerTool(name, definition, async (input, extra) => {
      try {
        const result = await service.getOutline(
          input,
          requestContext(extra.requestInfo?.headers),
          extra.signal,
        );
        return structuredResult(result);
      } catch (error) {
        return errorResult(error);
      }
    });
  }

  {
    const { name, ...definition } = SEARCH_TOOL_DEFINITION;
    server.registerTool(name, definition, async (input, extra) => {
      try {
        const result = await service.search(
          input,
          requestContext(extra.requestInfo?.headers),
          extra.signal,
        );
        return structuredResult(result);
      } catch (error) {
        return errorResult(error);
      }
    });
  }

  {
    const { name, ...definition } = READ_TOOL_DEFINITION;
    server.registerTool(name, definition, async (input, extra) => {
      try {
        const result = await service.read(
          input,
          requestContext(extra.requestInfo?.headers),
          extra.signal,
        );
        return structuredResult(result);
      } catch (error) {
        return errorResult(error);
      }
    });
  }

  const { name, ...definition } = VIEW_PAGE_TOOL_DEFINITION;
  server.registerTool(name, definition, async (input, extra) => {
    try {
      const result = await service.viewPage(
        input,
        requestContext(extra.requestInfo?.headers),
        extra.signal,
      );
      const bytes = await readFile(result.imagePath);
      return {
        content: [
          {
            type: "text",
            text: `Source: ${result.metadata.source.title} (${result.metadata.source.sourceId})\nPage: ${result.metadata.page}`,
          },
          {
            type: "image",
            data: bytesToBase64(bytes),
            mimeType: "image/png",
          },
        ],
        isError: false,
        _meta: {
          "zopilot.imageCount": 1,
          "zopilot.viewPage": result.metadata,
        },
      };
    } catch (error) {
      return errorResult(error);
    }
  });
}

function structuredResult<Output extends Record<string, unknown>>(
  structuredContent: Output,
): CallToolResult {
  return {
    content: [],
    structuredContent,
    isError: false,
  };
}

function errorResult(error: unknown): CallToolResult {
  if (!(error instanceof PaperToolError)) {
    logger.error("paper tool failed", error);
  }
  const message =
    error instanceof PaperToolError
      ? `${error.code}: ${error.message}`
      : "paper_tool_failed: The paper tool operation failed.";
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function requestContext(
  headers: Record<string, string | string[] | undefined> | undefined,
) {
  const normalized = normalizeRequestHeaders(headers);
  const binding = parsePaperBindingHeaders(normalized);
  const capabilities = parseMcpClientCapabilities(normalized);
  return {
    workspaceScope: binding.ok ? binding.value : undefined,
    bindingError: binding.ok ? undefined : binding.error,
    acceptsImages: capabilities.acceptsImages,
  };
}

function normalizeRequestHeaders(
  headers: Record<string, string | string[] | undefined> | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(", ") : value,
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return globalThis.btoa(binary);
}
