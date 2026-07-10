import type {
  MaterialArtifact,
  MaterialChunk,
  MaterialChunkKind,
  MaterialPage,
} from "../types";
import { pageRangeContains } from "../pageRange";
import { extractArtifacts } from "./artifactExtractor";

export { buildChunksAndArtifacts };

const TARGET_CHARS = 4200;
const MAX_CHARS = 7000;
const OVERLAP_CHARS = 480;

function buildChunksAndArtifacts(input: {
  sourceId: string;
  markdown: string;
  pages: MaterialPage[];
}): { chunks: MaterialChunk[]; artifacts: MaterialArtifact[] } {
  const chunks = chunkMarkdown(input.sourceId, input.markdown);
  attachPages(chunks, input.pages);
  const artifacts = extractArtifacts(chunks, input.pages);
  for (const artifact of artifacts) {
    for (const chunk of chunks) {
      if (
        pageRangeContains(chunk, artifact.page) ||
        chunk.text.toLowerCase().includes(artifact.label.toLowerCase())
      ) {
        artifact.surroundingChunkIds.push(chunk.id);
        chunk.artifactIds.push(artifact.id);
      }
    }
  }
  return { chunks, artifacts };
}

function chunkMarkdown(sourceId: string, markdown: string): MaterialChunk[] {
  const sections = splitSections(markdown);
  const chunks: MaterialChunk[] = [];

  for (const section of sections) {
    const kind = inferChunkKind(section.path, section.text);
    const parts = splitLongText(section.text, TARGET_CHARS, MAX_CHARS);
    for (const part of parts) {
      const index = chunks.length;
      chunks.push({
        id: `${sourceId}:chunk:${index}`,
        sourceId,
        index,
        kind,
        title: section.path.at(-1),
        sectionPath: section.path,
        text: part,
        artifactIds: [],
      });
    }
  }
  return chunks;
}

function splitSections(
  markdown: string,
): Array<{ path: string[]; text: string }> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const sections: Array<{ path: string[]; lines: string[] }> = [];
  let current: { path: string[]; lines: string[] } = {
    path: ["Document"],
    lines: [],
  };
  const headingStack: string[] = [];

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.lines.join("\n").trim()) {
        sections.push(current);
      }
      const level = normalizeHeadingLevel(heading[1].length, heading[2]);
      headingStack.splice(level - 1);
      headingStack[level - 1] = heading[2].trim();
      current = {
        path: headingStack.filter(Boolean),
        lines: [line],
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.join("\n").trim()) {
    sections.push(current);
  }

  return sections.map((section) => ({
    path: section.path.length ? section.path : ["Document"],
    text: section.lines.join("\n").trim(),
  }));
}

function splitLongText(
  text: string,
  targetChars: number,
  maxChars: number,
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const paragraphs = text.split(/\n{2,}/);
  const parts: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= targetChars || !current) {
      current = next;
      continue;
    }
    parts.push(current.trim());
    current = `${current.slice(Math.max(0, current.length - OVERLAP_CHARS))}\n\n${paragraph}`;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts.flatMap((part) => splitOversizedPart(part, maxChars));
}

function splitOversizedPart(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    const targetEnd = Math.min(text.length, start + maxChars);
    const boundary = findBoundary(text, start, targetEnd);
    parts.push(text.slice(start, boundary).trim());
    start = Math.max(boundary - OVERLAP_CHARS, start + 1);
  }
  return parts.filter(Boolean);
}

function findBoundary(text: string, start: number, targetEnd: number): number {
  if (targetEnd >= text.length) {
    return text.length;
  }
  const min = Math.max(start, targetEnd - 900);
  const paragraph = text.lastIndexOf("\n\n", targetEnd);
  if (paragraph >= min) {
    return paragraph;
  }
  const sentence = Math.max(
    text.lastIndexOf(". ", targetEnd),
    text.lastIndexOf("? ", targetEnd),
    text.lastIndexOf("! ", targetEnd),
    text.lastIndexOf("。", targetEnd),
    text.lastIndexOf("？", targetEnd),
    text.lastIndexOf("！", targetEnd),
  );
  return sentence >= min ? sentence + 1 : targetEnd;
}

function inferChunkKind(path: string[], text: string): MaterialChunkKind {
  const title = path.at(-1) || "";
  const haystack = `${title} ${text.slice(0, 160)}`.toLowerCase();
  if (/references|bibliography/.test(haystack)) {
    return "references";
  }
  if (/abstract|摘要/.test(haystack)) {
    return "abstract";
  }
  if (/^\s*\|.+\|\s*$/m.test(text)) {
    return "table";
  }
  if (/(figure|fig\.|图)\s*\d+/i.test(text)) {
    return "caption";
  }
  if (path.length <= 1 && text.length < 1000) {
    return "title";
  }
  return "body";
}

function attachPages(chunks: MaterialChunk[], pages: MaterialPage[]): void {
  const normalizedPages = pages.map((page) => ({
    page: page.page,
    text: page.text,
    normalized: normalizeForAnchor(page.text),
  }));
  for (const chunk of chunks) {
    let pageScores = normalizedPages
      .map((page) => ({
        page: page.page,
        score: anchorScore(chunk.text, page.normalized),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!pageScores.length) {
      pageScores = pages
        .map((page) => ({
          page: page.page,
          score: overlapScore(chunk.text, page.text),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score);
    }
    const best = pageScores[0]?.score || 0;
    const top = pageScores
      .filter((item) => item.score >= best * 0.6)
      .slice(0, 2)
      .map((item) => item.page);
    if (top.length) {
      chunk.pageStart = Math.min(...top);
      chunk.pageEnd = Math.max(...top);
    }
  }
}

function normalizeHeadingLevel(
  markdownLevel: number,
  rawTitle: string,
): number {
  const title = stripMarkdown(rawTitle).trim();
  const numbered = /^(\d+(?:\.\d+)*)\./.exec(title);
  if (numbered) {
    return Math.min(6, 2 + numbered[1].split(".").length - 1);
  }
  if (/^(abstract|references|bibliography|appendix)\b/i.test(title)) {
    return Math.min(markdownLevel, 2);
  }
  return markdownLevel;
}

function anchorScore(chunkText: string, normalizedPage: string): number {
  return anchorsFor(chunkText).reduce((score, anchor) => {
    if (!normalizedPage.includes(anchor)) {
      return score;
    }
    return score + Math.min(100, anchor.length);
  }, 0);
}

function anchorsFor(text: string): string[] {
  const candidates = stripMarkdown(text)
    .split(/\n+|(?<=[.!?。？！])\s+/)
    .map((line) => normalizeForAnchor(line))
    .filter((line) => line.length >= 36 && line.length <= 220)
    .filter((line) => !/^(figure|fig|table|tab)\d*/i.test(line));
  return Array.from(new Set(candidates)).slice(0, 12);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[#*_>|~`-]+/g, " ");
}

function normalizeForAnchor(text: string): string {
  return stripMarkdown(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function overlapScore(left: string, right: string): number {
  const leftTerms = new Set(
    tokenize(stripMarkdown(left))
      .filter((term) => term.length > 3 && !STOP_WORDS.has(term))
      .slice(0, 120),
  );
  if (!leftTerms.size) {
    return 0;
  }
  return tokenize(stripMarkdown(right))
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term))
    .reduce((total, term) => total + (leftTerms.has(term) ? 1 : 0), 0);
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "into",
  "such",
  "than",
  "then",
  "they",
  "their",
  "there",
  "these",
  "those",
  "which",
  "while",
  "where",
  "when",
  "what",
  "through",
  "using",
  "used",
  "paper",
]);

function tokenize(text: string): string[] {
  return Array.from(text.toLowerCase().matchAll(/[\p{L}\p{N}_-]{2,}/gu)).map(
    (match) => match[0],
  );
}
