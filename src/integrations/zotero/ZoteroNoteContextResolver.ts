import sanitizeHtml from "sanitize-html";
import type {
  NoteContextRef,
  ResolvedNoteContext,
  SourceMention,
  WorkspaceIdentity,
} from "../../domain/conversation";
import { getZoteroGlobal } from "./environment";
import {
  loadCachedZoteroItem,
  loadZoteroItem,
} from "./sources/ZoteroItemLookup";
import { ZoteroWorkspaceParentScope } from "./sources/ZoteroWorkspaceParentScope";

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

type ZoteroNoteParentItem = Zotero.Item & {
  id: number;
  key: string;
  libraryID: number;
  deleted?: boolean;
  isRegularItem?: () => boolean;
};

class ZoteroNoteContextResolver {
  private readonly parentScope: ZoteroWorkspaceParentScope;

  constructor(private readonly zotero: typeof Zotero = getZoteroGlobal()) {
    this.parentScope = new ZoteroWorkspaceParentScope(zotero);
  }

  async resolveAll(
    workspace: WorkspaceIdentity,
    references: NoteContextRef[],
    _mentions: SourceMention[] = [],
  ): Promise<ResolvedNoteContext[]> {
    if (!references.length) {
      return [];
    }
    const [allowedParentKeys, allowedItemKeys] = await Promise.all([
      this.parentScope.resolveAllowedParentKeys(workspace),
      this.parentScope.resolveAllowedItemKeys(workspace),
    ]);
    const parentCache = new Map<
      string,
      Promise<ZoteroNoteParentItem | undefined>
    >();
    return Promise.all(
      references.map(async (reference) => {
        return {
          reference,
          content: await this.resolveOne(
            workspace,
            reference,
            allowedParentKeys,
            allowedItemKeys,
            parentCache,
          ),
        };
      }),
    );
  }

  private async resolveOne(
    workspace: WorkspaceIdentity,
    reference: NoteContextRef,
    allowedParentKeys: ReadonlySet<string> | undefined,
    allowedItemKeys: ReadonlySet<string> | undefined,
    parentCache: Map<string, Promise<ZoteroNoteParentItem | undefined>>,
  ): Promise<string> {
    if (reference.libraryID !== workspace.libraryID) {
      throw new Error(
        `Selected note is outside the current workspace: ${reference.title}`,
      );
    }
    if (!reference.parentItemKey) {
      return this.resolveTopLevelNote(workspace, reference, allowedItemKeys);
    }
    if (allowedParentKeys && !allowedParentKeys.has(reference.parentItemKey)) {
      throw new Error(
        `Selected note is outside the current workspace: ${reference.title}`,
      );
    }
    const parent = await loadCachedZoteroItem<ZoteroNoteParentItem>(
      parentCache,
      this.zotero,
      {
        libraryID: reference.libraryID,
        itemID: reference.parentItemID,
        itemKey: reference.parentItemKey,
      },
    );
    if (
      !parent ||
      parent.deleted ||
      !parent.isRegularItem?.() ||
      parent.libraryID !== reference.libraryID ||
      parent.key !== reference.parentItemKey ||
      (reference.parentItemID !== undefined &&
        parent.id !== reference.parentItemID)
    ) {
      throw new Error(
        `Selected note parent is no longer available: ${reference.title}`,
      );
    }
    const note = await loadZoteroItem<ZoteroNoteItem>(this.zotero, {
      libraryID: reference.libraryID,
      itemID: reference.noteItemID,
    });
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

  private async resolveTopLevelNote(
    workspace: WorkspaceIdentity,
    reference: NoteContextRef,
    allowedItemKeys: ReadonlySet<string> | undefined,
  ): Promise<string> {
    if (
      workspace.workspaceType === "item" ||
      (allowedItemKeys && !allowedItemKeys.has(reference.noteItemKey))
    ) {
      throw new Error(
        `Selected note is outside the current workspace: ${reference.title}`,
      );
    }
    const note = await loadZoteroItem<ZoteroNoteItem>(this.zotero, {
      libraryID: reference.libraryID,
      itemID: reference.noteItemID,
    });
    if (
      !note ||
      note.deleted ||
      !note.isNote?.() ||
      note.id !== reference.noteItemID ||
      note.key !== reference.noteItemKey ||
      note.libraryID !== reference.libraryID ||
      note.parentItemID ||
      note.parentItemKey
    ) {
      throw new Error(
        `Selected top-level note is no longer available: ${reference.title}`,
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
