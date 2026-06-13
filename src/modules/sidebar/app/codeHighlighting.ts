import { createHighlighterCoreSync } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import latex from "shiki/langs/latex.mjs";
import markdown from "shiki/langs/markdown.mjs";
import python from "shiki/langs/python.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import xml from "shiki/langs/xml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const LANGUAGE_ALIASES = new Map([
  ["js", "javascript"],
  ["ts", "typescript"],
  ["py", "python"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["md", "markdown"],
  ["tex", "latex"],
]);

const SUPPORTED_LANGUAGES = new Set([
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "latex",
  "markdown",
  "python",
  "tsx",
  "typescript",
  "xml",
]);

let highlighter: ReturnType<typeof createHighlighterCoreSync> | undefined;

export function getCodeLanguage(className?: string): string | undefined {
  const match = /(?:^|\s)language-([\w-]+)/u.exec(className ?? "");
  if (!match) {
    return undefined;
  }
  return normalizeCodeLanguage(match[1]);
}

export function normalizeCodeLanguage(language: string): string {
  const rawLanguage = language.toLowerCase();
  return LANGUAGE_ALIASES.get(rawLanguage) ?? rawLanguage;
}

export function isHighlightLanguageSupported(language: string): boolean {
  return SUPPORTED_LANGUAGES.has(language);
}

export function highlightCodeWithShiki(
  text: string,
  language: string,
): string | undefined {
  if (!isHighlightLanguageSupported(language)) {
    return undefined;
  }

  try {
    return getHighlighter().codeToHtml(text, {
      lang: language,
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: "light",
    });
  } catch (error) {
    logHighlightError(language, error);
    return undefined;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getHighlighter(): ReturnType<typeof createHighlighterCoreSync> {
  highlighter ??= createHighlighterCoreSync({
    themes: [githubLight, githubDark],
    langs: [
      bash,
      css,
      html,
      javascript,
      json,
      jsx,
      latex,
      markdown,
      python,
      tsx,
      typescript,
      xml,
    ],
    engine: createJavaScriptRegexEngine({ target: "ES2018", forgiving: true }),
  });
  return highlighter;
}

function logHighlightError(language: string, error: unknown): void {
  const message =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const text = `[Zotero Copilot] Shiki failed to highlight ${language}: ${message}`;
  const root = globalThis as typeof globalThis & {
    Zotero?: { debug?: (message: string) => void };
  };
  root.Zotero?.debug?.(text);
  console.error(text);
}
