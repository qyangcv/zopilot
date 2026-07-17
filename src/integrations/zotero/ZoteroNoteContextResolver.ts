import sanitizeHtml from "sanitize-html";
import type {
  NoteContextRef,
  ResolvedNoteContext,
  WorkspaceIdentity,
} from "../../domain/conversation";
import { getZoteroGlobal } from "./environment";

type ZoteroNoteItem = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  deleted?: boolean;
  parentItemID?: number | false;
  parentItemKey?: string | false;
  getNote?: () => string;
  isNote?: () => boolean;
};

class ZoteroNoteContextResolver {
  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {}

  async resolveAll(
    workspace: WorkspaceIdentity,
    references: NoteContextRef[],
  ): Promise<ResolvedNoteContext[]> {
    if (workspace.workspaceType !== "item" || !workspace.itemKey) {
      throw new Error("Selected Zotero notes require an item workspace.");
    }
    return Promise.all(
      references.map(async (reference) => ({
        reference,
        content: await this.resolveOne(workspace, reference),
      })),
    );
  }

  private async resolveOne(
    workspace: WorkspaceIdentity,
    reference: NoteContextRef,
  ): Promise<string> {
    if (
      reference.libraryID !== workspace.libraryID ||
      reference.parentItemKey !== workspace.itemKey
    ) {
      throw new Error(
        `Selected note is outside the current item workspace: ${reference.title}`,
      );
    }
    let note: ZoteroNoteItem | undefined;
    try {
      note = (await this.zotero.Items.getAsync(
        reference.noteItemID,
      )) as ZoteroNoteItem;
    } catch {
      note = undefined;
    }
    if (
      !note ||
      note.deleted ||
      !note.isNote?.() ||
      note.id !== reference.noteItemID ||
      note.key !== reference.noteItemKey ||
      note.libraryID !== reference.libraryID ||
      note.parentItemKey !== reference.parentItemKey ||
      (reference.parentItemID !== undefined &&
        note.parentItemID !== reference.parentItemID)
    ) {
      throw new Error(
        `Selected note no longer belongs to the current item: ${reference.title}`,
      );
    }
    return noteHtmlToText(note.getNote?.() || "");
  }
}

function noteHtmlToText(html: string): string {
  const safe = sanitizeHtml(html, {
    allowedTags: [
      "a",
      "b",
      "blockquote",
      "br",
      "code",
      "dd",
      "div",
      "dl",
      "dt",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "i",
      "li",
      "ol",
      "p",
      "pre",
      "s",
      "span",
      "strong",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "u",
      "ul",
    ],
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["http", "https", "mailto", "zotero"],
    disallowedTagsMode: "discard",
  });

  const text = safe
    .replace(
      /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/giu,
      (_match, href: string, label: string) => {
        const cleanLabel = stripTags(label).trim();
        const cleanHref = decodeHtmlEntities(href).trim();
        return cleanHref && cleanHref !== cleanLabel
          ? `${cleanLabel || cleanHref} (${cleanHref})`
          : cleanLabel || cleanHref;
      },
    )
    .replace(/<h([1-6])\b[^>]*>/giu, (_match, level: string) => {
      return `\n${"#".repeat(Number(level))} `;
    })
    .replace(/<blockquote\b[^>]*>/giu, "\n> ")
    .replace(/<pre\b[^>]*>/giu, "\n```\n")
    .replace(/<\/pre>/giu, "\n```\n")
    .replace(/<li\b[^>]*>/giu, "\n- ")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|ol|ul|blockquote|dl|dt|dd)>/giu, "\n")
    .replace(/<\/(?:td|th)>/giu, "\t")
    .replace(/<\/tr>/giu, "\n")
    .replace(/<code\b[^>]*>/giu, "`")
    .replace(/<\/code>/giu, "`")
    .replace(/<[^>]+>/gu, "");

  return normalizeNoteText(decodeHtmlEntities(text));
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/gu, ""));
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#(?:x[\da-f]+|\d+)|[a-z]+);/giu,
    (entity, token: string) => {
      if (token[0] !== "#") {
        return named[token.toLowerCase()] ?? entity;
      }
      const hexadecimal = token[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(
        token.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      return Number.isFinite(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}

function normalizeNoteText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/gu, ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export { ZoteroNoteContextResolver, noteHtmlToText };
