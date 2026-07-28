import { z } from "zod";

export {
  createChunkLocator,
  createDocumentLocator,
  createMaterialRevision,
  createSectionLocator,
  matchesMaterialRevision,
  parseLocator,
  type PaperLocator,
};

// Increment when section or chunk ordinals can resolve to different IR content.
const MATERIAL_COORDINATE_VERSION = 1;
const MATERIAL_REVISION_BYTES = 12;
const PDF_HASH_PATTERN = /^[a-f0-9]{64}$/iu;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/u;
const MATERIAL_REVISION_PATTERN = /^[A-Za-z0-9_-]{16}$/u;

const paperLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    sourceId: z.string().regex(SOURCE_ID_PATTERN),
    revision: z.string().regex(MATERIAL_REVISION_PATTERN),
    kind: z.literal("document"),
  }),
  z.object({
    sourceId: z.string().regex(SOURCE_ID_PATTERN),
    revision: z.string().regex(MATERIAL_REVISION_PATTERN),
    kind: z.literal("section"),
    id: z.string().regex(/^section-[0-9]+$/u),
  }),
  z.object({
    sourceId: z.string().regex(SOURCE_ID_PATTERN),
    revision: z.string().regex(MATERIAL_REVISION_PATTERN),
    kind: z.literal("chunk"),
    id: z.string().regex(/^chunk-[0-9]+$/u),
  }),
]);

type PaperLocator = z.infer<typeof paperLocatorSchema>;
type LocatorKind = PaperLocator["kind"];

function createDocumentLocator(sourceId: string, pdfHash: string): string {
  return encodeLocator({
    sourceId,
    revision: createMaterialRevision(pdfHash),
    kind: "document",
  });
}

function createSectionLocator(
  sourceId: string,
  pdfHash: string,
  id: string,
): string {
  return encodeLocator({
    sourceId,
    revision: createMaterialRevision(pdfHash),
    kind: "section",
    id,
  });
}

function createChunkLocator(
  sourceId: string,
  pdfHash: string,
  id: string,
): string {
  return encodeLocator({
    sourceId,
    revision: createMaterialRevision(pdfHash),
    kind: "chunk",
    id,
  });
}

function createMaterialRevision(pdfHash: string): string {
  if (!PDF_HASH_PATTERN.test(pdfHash)) {
    throw new Error("Invalid PDF hash.");
  }
  const bytes = new Uint8Array(MATERIAL_REVISION_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(pdfHash.slice(index * 2, index * 2 + 2), 16);
  }
  bytes[0] ^= MATERIAL_COORDINATE_VERSION;
  return encodeBytes(bytes);
}

function matchesMaterialRevision(revision: string, pdfHash: string): boolean {
  try {
    return revision === createMaterialRevision(pdfHash);
  } catch {
    return false;
  }
}

function parseLocator(value: string): PaperLocator {
  try {
    const parts = value.split(".");
    const kind = decodeKind(parts[0]);
    const expectedLength = kind === "document" ? 3 : 4;
    if (parts.length !== expectedLength) throw new Error();
    const sourceId = parts[1];
    const revision = parts[2];
    return paperLocatorSchema.parse({
      kind,
      sourceId,
      revision,
      ...(kind === "document" ? {} : { id: decodeTargetId(kind, parts[3]) }),
    });
  } catch {
    throw new Error("Invalid paper locator.");
  }
}

function encodeLocator(locator: PaperLocator): string {
  const parsed = paperLocatorSchema.parse(locator);
  return [
    encodeKind(parsed.kind),
    parsed.sourceId,
    parsed.revision,
    ...(parsed.kind === "document"
      ? []
      : [encodeTargetId(parsed.kind, parsed.id)]),
  ].join(".");
}

function encodeKind(kind: LocatorKind): string {
  if (kind === "document") return "doc";
  if (kind === "section") return "section";
  return "chunk";
}

function decodeKind(value: string): LocatorKind {
  if (value === "doc") return "document";
  if (value === "section") return "section";
  if (value === "chunk") return "chunk";
  throw new Error();
}

function encodeTargetId(
  kind: Exclude<LocatorKind, "document">,
  id: string,
): string {
  const prefix = kind === "section" ? "section-" : "chunk-";
  if (!id.startsWith(prefix)) throw new Error("Invalid locator target.");
  const ordinal = Number.parseInt(id.slice(prefix.length), 10);
  if (
    !/^[0-9]+$/u.test(id.slice(prefix.length)) ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1
  ) {
    throw new Error("Invalid locator target.");
  }
  return ordinal.toString(36);
}

function decodeTargetId(
  kind: Exclude<LocatorKind, "document">,
  value: string,
): string {
  if (!/^[0-9a-z]+$/u.test(value)) throw new Error();
  const ordinal = Number.parseInt(value, 36);
  if (
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1 ||
    ordinal.toString(36) !== value
  ) {
    throw new Error();
  }
  const width = kind === "section" ? 4 : 6;
  return `${kind}-${String(ordinal).padStart(width, "0")}`;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
