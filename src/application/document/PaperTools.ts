import { z } from "zod";
import { MAX_SELECTED_CONTEXTS } from "../../domain/contextSelection";

export {
  GET_OUTLINE_TOOL_DEFINITION,
  SEARCH_TOOL_DEFINITION,
  READ_TOOL_DEFINITION,
  VIEW_PAGE_TOOL_DEFINITION,
  ZOPILOT_PAPER_TOOL_NAMES,
  getOutlineInputSchema,
  getOutlineOutputSchema,
  searchInputSchema,
  searchOutputSchema,
  readInputSchema,
  readOutputSchema,
  viewPageInputSchema,
};

const sourceInputSchema = z.object({
  sourceId: z
    .string()
    .optional()
    .describe(
      "The Zopilot source ID to use. Omit only when this conversation has one default paper.",
    ),
});

const sourceOutputSchema = z.object({
  sourceId: z.string(),
  title: z.string(),
  pageCount: z.number().int().nonnegative(),
});

type OutlineNodeOutput = {
  sectionId: string;
  title: string;
  level: number;
  startPage: number;
  endPage: number;
  locator: string;
  provenance: "embedded" | "inferred";
  children: OutlineNodeOutput[];
};

const outlineNodeSchema: z.ZodType<OutlineNodeOutput> = z.object({
  sectionId: z.string(),
  title: z.string(),
  level: z.number().int().positive(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  locator: z.string(),
  provenance: z.enum(["embedded", "inferred"]),
  children: z.lazy(() => z.array(outlineNodeSchema)),
});

const getOutlineInputSchema = sourceInputSchema.strict();
const getOutlineOutputSchema = z.object({
  status: z.enum(["ready", "partial", "unavailable"]),
  source: sourceOutputSchema,
  rootLocator: z.string(),
  outline: z.array(outlineNodeSchema),
  provenance: z.enum(["embedded", "inferred", "mixed", "unavailable"]),
  warnings: z.array(z.string()),
});

const searchInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe(
        "Text or a natural-language information need to locate in the paper. This searches only; it does not answer the question.",
      ),
    sourceIds: z
      .array(z.string().min(1))
      .max(MAX_SELECTED_CONTEXTS)
      .optional()
      .describe(
        "The Zopilot source IDs to search. Omit only when this conversation has one default paper.",
      ),
    limit: z.number().int().min(1).max(20).default(8),
  })
  .strict();
const searchOutputSchema = z.object({
  status: z.enum(["ready", "no_match"]),
  sources: z.array(sourceOutputSchema),
  matches: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      preview: z.string(),
      page: z.number().int().positive().optional(),
      sectionPath: z.array(z.string()),
      score: z.number(),
      locator: z.string(),
    }),
  ),
  warnings: z.array(z.string()),
});

const readInputSchema = z
  .object({
    locator: z
      .string()
      .min(1)
      .describe(
        "An opaque locator returned by get_outline or search. Copy it exactly; never construct one.",
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        "The continuation cursor returned by a previous read call for the same locator.",
      ),
  })
  .strict();
const readOutputSchema = z.object({
  status: z.literal("ready"),
  source: sourceOutputSchema,
  locator: z.string(),
  resolvedRange: z.object({
    startPage: z.number().int().positive(),
    endPage: z.number().int().positive(),
    sectionPath: z.array(z.string()),
  }),
  blocks: z.array(
    z.object({
      blockId: z.string(),
      type: z.enum([
        "title",
        "heading",
        "paragraph",
        "list",
        "caption",
        "table",
        "equation",
        "footnote",
        "figure",
        "other",
      ]),
      text: z.string(),
      page: z.number().int().positive(),
      bbox: z
        .tuple([z.number(), z.number(), z.number(), z.number()])
        .optional(),
    }),
  ),
  complete: z.boolean(),
  nextCursor: z.string().optional(),
  warnings: z.array(z.string()),
});

const viewPageInputSchema = sourceInputSchema
  .extend({
    page: z
      .number()
      .int()
      .positive()
      .describe("The one-based physical PDF page number to render."),
  })
  .strict();
const commonAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const GET_OUTLINE_TOOL_DEFINITION = {
  name: "get_outline",
  title: "Get paper outline",
  description:
    "Get the complete hierarchical outline and section locators for one paper. Use this first to understand the paper structure or choose a section. It does not return section text; pass a returned locator to read.",
  inputSchema: getOutlineInputSchema,
  outputSchema: getOutlineOutputSchema,
  annotations: commonAnnotations,
} as const;

const SEARCH_TOOL_DEFINITION = {
  name: "search",
  title: "Search paper text",
  description:
    "Find relevant locations in one or more papers when you know what information you need but not where it appears. It returns short previews and locators, not complete evidence. Pass a selected locator to read.",
  inputSchema: searchInputSchema,
  outputSchema: searchOutputSchema,
  annotations: commonAnnotations,
} as const;

const READ_TOOL_DEFINITION = {
  name: "read",
  title: "Read paper text",
  description:
    "Read complete original paper text at one known locator returned by get_outline or search. Use this only after you have a locator, and continue with nextCursor when complete is false. It does not search, rank, summarize, or render pages.",
  inputSchema: readInputSchema,
  outputSchema: readOutputSchema,
  annotations: commonAnnotations,
} as const;

const VIEW_PAGE_TOOL_DEFINITION = {
  name: "view_page",
  title: "View a paper page",
  description:
    "View one original PDF page as an image. Use this for figures, tables, equations, layout, scanned content, or when extracted text may be unreliable. It does not return parsed text.",
  inputSchema: viewPageInputSchema,
  annotations: commonAnnotations,
} as const;

const ZOPILOT_PAPER_TOOL_NAMES = [
  GET_OUTLINE_TOOL_DEFINITION.name,
  SEARCH_TOOL_DEFINITION.name,
  READ_TOOL_DEFINITION.name,
  VIEW_PAGE_TOOL_DEFINITION.name,
] as const;
