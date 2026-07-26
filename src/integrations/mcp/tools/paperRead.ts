import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  PAPER_READ_MAX_SOURCES,
  PaperReadService,
  type PaperReadBusinessResult,
} from "../../../application/document/PaperReadService";
import { geckoIO } from "../../../platform/gecko";
import {
  parseMcpClientCapabilities,
  parsePaperBindingHeaders,
} from "../workspaceBinding";

export { registerPaperReadTool, type RegisterPaperReadToolOptions };

type RegisterPaperReadToolOptions = {
  service?: PaperReadService;
  readFile?: (path: string) => Promise<Uint8Array>;
};

const inputSchema = z
  .object({
    question: z
      .string()
      .optional()
      .describe(
        "The paper-specific reading question or natural-language information need.",
      ),
    sourceIds: z
      .array(z.string())
      .max(PAPER_READ_MAX_SOURCES)
      .optional()
      .describe(
        "Optional Zopilot source IDs selected from the current workspace context.",
      ),
  })
  .strict();

const outputSchema = z.object({
  status: z.string(),
  workspace: z
    .object({
      key: z.string(),
      type: z.string(),
      label: z.string(),
    })
    .optional(),
  sources: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
    }),
  ),
  evidence: z.array(
    z.object({
      sourceId: z.string(),
      page: z.number().optional(),
      label: z.string().optional(),
      section: z.array(z.string()),
    }),
  ),
  warnings: z.array(z.string()),
  images: z.array(
    z.object({
      sourceId: z.string(),
      page: z.number().optional(),
      mimeType: z.literal("image/png"),
    }),
  ),
});

function registerPaperReadTool(
  server: McpServer,
  options: RegisterPaperReadToolOptions = {},
): void {
  const service = options.service || new PaperReadService();
  const readFile = options.readFile || ((path) => geckoIO.read(path));
  server.registerTool(
    "paper_read",
    {
      title: "Read Zopilot paper context",
      description:
        "Retrieve traceable evidence, page numbers, and relevant page images from PDFs in the current Zopilot workspace. It provides evidence and does not answer for the agent.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input, extra) => {
      const headers = normalizeRequestHeaders(extra.requestInfo?.headers);
      const binding = parsePaperBindingHeaders(headers);
      const capabilities = parseMcpClientCapabilities(headers);
      const result = await service.read(input, {
        workspaceScope: binding.ok ? binding.value : undefined,
        bindingError: binding.ok ? undefined : binding.error,
        acceptsImages: capabilities.acceptsImages,
      });
      return createCallToolResult(result, readFile);
    },
  );
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
