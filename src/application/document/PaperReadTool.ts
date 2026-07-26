import { z } from "zod";
import { PAPER_READ_MAX_SOURCES } from "./PaperReadService";

const paperReadInputSchema = z
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

const paperReadOutputSchema = z.object({
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

const PAPER_READ_TOOL_DEFINITION = {
  name: "paper_read",
  title: "Read Zopilot paper context",
  description:
    "Retrieve traceable evidence, page numbers, and relevant page images from PDFs in the current Zopilot workspace. It provides evidence and does not answer for the agent.",
  inputSchema: paperReadInputSchema,
  outputSchema: paperReadOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export {
  PAPER_READ_TOOL_DEFINITION,
  paperReadInputSchema,
  paperReadOutputSchema,
};
