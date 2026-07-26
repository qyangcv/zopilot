import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PAPER_READ_TOOL_DEFINITION } from "../../application/document/PaperReadTool";
import {
  PaperReadService,
  type PaperReadBusinessResult,
} from "../../application/document/PaperReadService";
import { geckoIO } from "../../platform/gecko";
import {
  parseMcpClientCapabilities,
  parsePaperBindingHeaders,
} from "./workspaceBinding";

type RegisterPaperReadToolOptions = {
  service?: PaperReadService;
  readFile?: (path: string) => Promise<Uint8Array>;
};

function registerPaperReadTool(
  server: McpServer,
  options: RegisterPaperReadToolOptions = {},
): void {
  const service = options.service || new PaperReadService();
  const readFile = options.readFile || ((path) => geckoIO.read(path));
  const { name, ...definition } = PAPER_READ_TOOL_DEFINITION;
  server.registerTool(name, definition, async (input, extra) => {
    const headers = normalizeRequestHeaders(extra.requestInfo?.headers);
    const binding = parsePaperBindingHeaders(headers);
    const capabilities = parseMcpClientCapabilities(headers);
    const result = await service.read(
      input,
      {
        workspaceScope: binding.ok ? binding.value : undefined,
        bindingError: binding.ok ? undefined : binding.error,
        acceptsImages: capabilities.acceptsImages,
      },
      extra.signal,
    );
    return createCallToolResult(result, readFile);
  });
}

async function createCallToolResult(
  result: PaperReadBusinessResult,
  readFile: (path: string) => Promise<Uint8Array>,
): Promise<CallToolResult> {
  const content: CallToolResult["content"] = [
    {
      type: "text",
      text: result.text,
    },
  ];
  const structuredContent = {
    ...result.structuredContent,
    warnings: [...result.structuredContent.warnings],
    images: [] as PaperReadBusinessResult["structuredContent"]["images"],
  };
  const imageWarnings: string[] = [];
  for (const image of result.images) {
    try {
      const bytes = await readFile(image.path);
      content.push({
        type: "image",
        data: bytesToBase64(bytes),
        mimeType: image.mimeType,
      });
      structuredContent.images.push({
        sourceId: image.sourceId,
        page: image.page,
        mimeType: image.mimeType,
      });
    } catch {
      imageWarnings.push(
        `Could not read the page image for ${image.sourceId}${
          image.page === undefined ? "" : ` page ${image.page}`
        }.`,
      );
    }
  }
  if (imageWarnings.length) {
    structuredContent.warnings.push(...imageWarnings);
    const textContent = content[0];
    if (textContent.type === "text") {
      textContent.text = [
        textContent.text,
        ...imageWarnings.map((warning) => `Warning: ${warning}`),
      ].join("\n\n");
    }
  }
  return {
    content,
    structuredContent,
    isError: result.isError,
    _meta: {
      "zopilot.imageCount": structuredContent.images.length,
    },
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

export { registerPaperReadTool };
export type { RegisterPaperReadToolOptions };
