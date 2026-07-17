import { footnote } from "@mdit/plugin-footnote";
import { tasklist } from "@mdit/plugin-tasklist";
import { tex } from "@mdit/plugin-tex";
import katex from "katex";
import MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import sanitizeHtml from "sanitize-html";
import {
  escapeHtml,
  getCodeLanguage,
  highlightCodeWithShiki,
} from "./codeHighlighting";
import {
  beginSidebarPerformanceMeasure,
  recordSidebarPerformanceMetric,
} from "./performanceMetrics";
import { renderStaticIconHtml } from "./staticIcons";

type MarkdownRenderEnv = {
  sourceLines?: string[];
  unsafeLinkStack?: boolean[];
};

type MarkdownRenderOptions = {
  unwrapSingleParagraph?: boolean;
};

export type StreamingMarkdownSegment = {
  id: string;
  text: string;
};

declare const sanitizedHtmlBrand: unique symbol;
type SanitizedHtml = string & { readonly [sanitizedHtmlBrand]: true };

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "zotero:"]);
const CROSS_BLOCK_MARKDOWN_PATTERN =
  /(?:\[[^\]]+\]\s*\[[^\]]*\]|\[\^[^\]]+\]|^\s{0,3}\[[^\]]+\]:)/mu;
const MAX_KATEX_CACHE_ENTRIES = 128;
const katexCache = new Map<string, string>();

export function splitStreamingMarkdown(
  markdown: string,
): readonly StreamingMarkdownSegment[] {
  if (!markdown) return [];
  if (CROSS_BLOCK_MARKDOWN_PATTERN.test(markdown)) {
    return [{ id: "all", text: markdown }];
  }

  const details = { textLength: markdown.length };
  const finish = beginSidebarPerformanceMeasure("markdown.segment", details);
  try {
    const env: MarkdownRenderEnv = {
      sourceLines: markdown.split(/\r?\n/u),
      unsafeLinkStack: [],
    };
    const starts = [
      ...new Set(
        markdownIt
          .parse(markdown, env)
          .filter(
            (token) =>
              token.level === 0 &&
              token.block &&
              token.map &&
              token.nesting !== -1,
          )
          .map((token) => token.map![0]),
      ),
    ].sort((left, right) => left - right);
    if (starts.length < 2) {
      return [{ id: "line-0", text: markdown }];
    }

    const lineOffsets = getLineOffsets(markdown);
    return starts.map((line, index) => {
      const start = index === 0 ? 0 : (lineOffsets[line] ?? markdown.length);
      const nextLine = starts[index + 1];
      const end =
        nextLine === undefined
          ? markdown.length
          : (lineOffsets[nextLine] ?? markdown.length);
      return {
        id: `offset-${start}`,
        text: markdown.slice(start, end),
      };
    });
  } finally {
    finish?.();
  }
}

export function renderMarkdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
): SanitizedHtml {
  const details = { textLength: markdown.length };
  const finishTotal = beginSidebarPerformanceMeasure("markdown.total", details);
  try {
    const unsafeLinkStack: boolean[] = [];
    const env: MarkdownRenderEnv = {
      sourceLines: markdown.split(/\r?\n/u),
      unsafeLinkStack,
    };
    const finishParse = beginSidebarPerformanceMeasure(
      "markdown.parse",
      details,
    );
    let tokens: ReturnType<MarkdownIt["parse"]>;
    try {
      tokens = markdownIt.parse(markdown, env);
    } finally {
      finishParse?.();
    }

    const finishRender = beginSidebarPerformanceMeasure(
      "markdown.render",
      details,
    );
    let html: string;
    try {
      html =
        options.unwrapSingleParagraph && isSingleParagraph(tokens)
          ? markdownIt.renderer.renderInline(
              tokens[1].children ?? [],
              markdownIt.options,
              env,
            )
          : markdownIt.renderer.render(tokens, markdownIt.options, env);
    } finally {
      finishRender?.();
    }

    const finishSanitize = beginSidebarPerformanceMeasure(
      "markdown.sanitize",
      details,
    );
    try {
      return sanitizeMarkdownHtml(html);
    } finally {
      finishSanitize?.();
    }
  } finally {
    finishTotal?.();
  }
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith("#");
}

function getLineOffsets(markdown: string): number[] {
  const offsets = [0];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function createMarkdownIt(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
  });

  md.validateLink = () => true;
  installRendererRules(md);
  md.use(tasklist, {
    checkboxClass: "zp-task-checkbox",
    containerClass: "contains-task-list",
    disabled: true,
    itemClass: "task-list-item",
    label: false,
  });
  md.use(footnote);
  md.use(tex, {
    allowInlineWithSpace: false,
    delimiters: "all",
    mathFence: true,
    render: renderMathWithKatex,
  });

  return md;
}

function isSingleParagraph(tokens: ReturnType<MarkdownIt["parse"]>): boolean {
  return (
    tokens.length === 3 &&
    tokens[0].type === "paragraph_open" &&
    tokens[1].type === "inline" &&
    tokens[2].type === "paragraph_close"
  );
}

function installRendererRules(md: MarkdownIt): void {
  md.renderer.rules.fence = (tokens, idx, _options, env, _self) => {
    const token = tokens[idx];
    const language = getCodeLanguage(`language-${token.info.trim()}`);
    if (!language || !isClosedFence(token, env as MarkdownRenderEnv)) {
      return renderPlainCodeBlock(token.content, "");
    }

    const highlighted = highlightCodeWithShiki(token.content, language);
    return renderCodeBlock({
      highlighted,
      language,
      text: token.content.replace(/\n$/u, ""),
    });
  };

  md.renderer.rules.code_block = (tokens, idx) =>
    renderPlainCodeBlock(tokens[idx].content, "");

  md.renderer.rules.code_inline = (tokens, idx) =>
    `<code>${escapeHtml(tokens[idx].content)}</code>`;

  md.renderer.rules.html_block = () => "";
  md.renderer.rules.html_inline = () => "";

  md.renderer.rules.heading_open = renderHeadingOpen;
  md.renderer.rules.heading_close = renderHeadingClose;
  md.renderer.rules.image = renderImage;
  md.renderer.rules.link_open = renderLinkOpen;
  md.renderer.rules.link_close = renderLinkClose;
  md.renderer.rules.s_open = () => "<del>";
  md.renderer.rules.s_close = () => "</del>";
  md.renderer.rules.table_open = () => '<div class="zp-table-scroll"><table>';
  md.renderer.rules.table_close = () => "</table></div>";
}

function isClosedFence(
  token: { map?: [number, number] | null; markup: string },
  env: MarkdownRenderEnv,
): boolean {
  const endLine = token.map?.[1];
  const closingLine =
    endLine === undefined ? undefined : env.sourceLines?.[endLine - 1];
  const marker = token.markup;
  if (!closingLine || !marker) return false;
  const trimmed = closingLine.trim();
  return (
    trimmed.length >= marker.length &&
    [...trimmed].every((character) => character === marker[0])
  );
}

const renderHeadingOpen: RenderRule = function renderHeadingOpen(tokens, idx) {
  const level = getHeadingLevel(tokens[idx].tag);
  return `<h${Math.min(level + 1, 6)} class="zp-markdown-heading zp-markdown-heading-${level}">`;
};

const renderHeadingClose: RenderRule = function renderHeadingClose(
  tokens,
  idx,
) {
  const level = getHeadingLevel(tokens[idx].tag);
  return `</h${Math.min(level + 1, 6)}>`;
};

const renderImage: RenderRule = function renderImage(tokens, idx) {
  const token = tokens[idx];
  const src = token.attrGet("src") ?? "";
  const label = token.content.trim() || "image";
  const escapedLabel = escapeHtml(label);

  if (!isSafeExternalUrl(src)) {
    return [
      '<span class="zp-markdown-image">',
      `<span class="zp-markdown-image-label">${escapedLabel}</span>`,
      "</span>",
    ].join("");
  }

  const escapedSrc = escapeHtml(src);
  return [
    '<span class="zp-markdown-image">',
    `<span class="zp-markdown-image-label">${escapedLabel}</span> `,
    `<a href="${escapedSrc}" rel="noopener noreferrer" target="_blank">${escapedSrc}</a>`,
    "</span>",
  ].join("");
};

const renderLinkOpen: RenderRule = function renderLinkOpen(
  tokens,
  idx,
  _options,
  env,
) {
  const renderEnv = env as MarkdownRenderEnv;
  const href = tokens[idx].attrGet("href") ?? "";
  const isSafe = isInternalUrl(href) || isSafeExternalUrl(href);
  renderEnv.unsafeLinkStack ??= [];
  renderEnv.unsafeLinkStack.push(!isSafe);

  if (!isSafe) {
    return '<span class="zp-unsafe-link">';
  }

  const escapedHref = escapeHtml(href);
  if (isInternalUrl(href)) {
    return `<a href="${escapedHref}">`;
  }

  return `<a href="${escapedHref}" rel="noopener noreferrer" target="_blank">`;
};

const renderLinkClose: RenderRule = function renderLinkClose(
  _tokens,
  _idx,
  _options,
  env,
) {
  const renderEnv = env as MarkdownRenderEnv;
  return renderEnv.unsafeLinkStack?.pop() ? "</span>" : "</a>";
};

function renderMathWithKatex(content: string, displayMode: boolean): string {
  const cacheKey = `${displayMode ? "display" : "inline"}\0${content}`;
  const cached = katexCache.get(cacheKey);
  if (cached !== undefined) {
    recordSidebarPerformanceMetric("markdown.katex.cacheHit", 0, {
      textLength: content.length,
    });
    return cached;
  }

  const finish = beginSidebarPerformanceMeasure("markdown.katex", {
    textLength: content.length,
  });
  try {
    const rendered = katex.renderToString(content, {
      displayMode,
      throwOnError: false,
    });
    if (katexCache.size >= MAX_KATEX_CACHE_ENTRIES) {
      const oldestKey = katexCache.keys().next().value;
      if (oldestKey !== undefined) katexCache.delete(oldestKey);
    }
    katexCache.set(cacheKey, rendered);
    return rendered;
  } finally {
    finish?.();
  }
}

function renderCodeBlock({
  highlighted,
  language,
  text,
}: {
  highlighted: string | undefined;
  language: string;
  text: string;
}): string {
  const displayLanguage = language || "text";
  const escapedLanguage = escapeHtml(displayLanguage);
  const copyButton = text
    ? `<button aria-label="Copy code" class="zp-code-copy zp-inline-copy" data-zp-copy-code="${escapeHtml(
        encodeURIComponent(text),
      )}" title="Copy code" type="button">${renderStaticIconHtml("copy", {
        className: "zp-icon zp-code-copy-icon",
      })}</button>`
    : "";
  const content = highlighted
    ? `<div class="zp-code-content">${highlighted}</div>`
    : `<pre class="zp-code-plain"><code class="language-${escapedLanguage}">${escapeHtml(
        text,
      )}</code></pre>`;

  return [`<div class="zp-code-block">`, copyButton, content, "</div>"].join(
    "",
  );
}

function renderPlainCodeBlock(text: string, language: string): string {
  return renderCodeBlock({
    highlighted: undefined,
    language,
    text: text.replace(/\n$/u, ""),
  });
}

function getHeadingLevel(tag: string): number {
  const match = /^h([1-6])$/u.exec(tag);
  return match ? Number(match[1]) : 6;
}

function isSafeExternalUrl(url: string): boolean {
  if (!/^[A-Za-z][\w+.-]*:/u.test(url)) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function sanitizeMarkdownHtml(html: string): SanitizedHtml {
  return sanitizeHtml(html, {
    allowProtocolRelative: false,
    allowedAttributes: {
      "*": [
        "aria-hidden",
        "aria-label",
        "class",
        "data-*",
        "id",
        "role",
        "style",
        "title",
      ],
      a: ["class", "href", "id", "rel", "target", "title"],
      annotation: ["encoding"],
      button: ["aria-label", "class", "data-zp-copy-code", "title", "type"],
      input: ["checked", "class", "disabled", "readonly", "type"],
      circle: ["cx", "cy", "r"],
      line: ["x1", "x2", "y1", "y2"],
      path: ["d"],
      rect: ["height", "rx", "ry", "width", "x", "y"],
      span: ["aria-hidden", "class", "style"],
      svg: [
        "aria-hidden",
        "class",
        "data-icon-name",
        "fill",
        "focusable",
        "height",
        "stroke",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-width",
        "viewbox",
        "width",
      ],
    },
    allowedSchemes: ["http", "https", "mailto", "zotero"],
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "annotation",
      "button",
      "circle",
      "del",
      "input",
      "line",
      "math",
      "menclose",
      "mfrac",
      "mi",
      "mn",
      "mo",
      "mover",
      "mpadded",
      "mphantom",
      "mrow",
      "mspace",
      "msqrt",
      "mstyle",
      "msub",
      "msubsup",
      "msup",
      "mtable",
      "mtd",
      "mtext",
      "mtr",
      "munder",
      "munderover",
      "path",
      "rect",
      "semantics",
      "svg",
    ],
  }) as SanitizedHtml;
}

const markdownIt = createMarkdownIt();
