import { z } from "zod";
import type { MaterialBlock, MaterialOutline } from "../types";

export { parseMaterialBlock, parseMaterialOutline };

const materialBlockSchema: z.ZodType<MaterialBlock> = z.object({
  id: z.string().min(1),
  page: z.number().int().positive(),
  index: z.number().int().nonnegative(),
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
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  headingLevel: z.number().int().positive().max(6).optional(),
});

const materialOutlineSchema: z.ZodType<MaterialOutline> = z.object({
  status: z.enum(["ready", "partial", "unavailable"]),
  provenance: z.enum(["embedded", "inferred", "mixed", "unavailable"]),
  entries: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      level: z.number().int().positive().max(6),
      page: z.number().int().positive(),
      blockId: z.string().min(1).optional(),
      provenance: z.enum(["embedded", "inferred"]),
    }),
  ),
  warnings: z.array(z.string()),
});

function parseMaterialBlock(value: unknown): MaterialBlock {
  return materialBlockSchema.parse(value);
}

function parseMaterialOutline(value: unknown): MaterialOutline {
  return materialOutlineSchema.parse(value);
}
