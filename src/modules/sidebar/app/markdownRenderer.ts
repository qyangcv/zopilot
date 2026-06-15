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

type MarkdownRenderEnv = {
  unsafeLinkStack?: boolean[];
};

type MarkdownRenderOptions = {
  unwrapSingleParagraph?: boolean;
};

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "zotero:"]);

export function renderMarkdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
): string {
  const unsafeLinkStack: boolean[] = [];
  const env: MarkdownRenderEnv = { unsafeLinkStack };
  const tokens = markdownIt.parse(markdown, env);
  const html =
    options.unwrapSingleParagraph && isSingleParagraph(tokens)
      ? markdownIt.renderer.renderInline(
          tokens[1].children ?? [],
          markdownIt.options,
          env,
        )
      : markdownIt.renderer.render(tokens, markdownIt.options, env);
  return sanitizeMarkdownHtml(html);
}

export function isInternalUrl(url: string): boolean {
  return url.startsWith("#");
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
  md.renderer.rules.fence = (tokens, idx, _options, _env, _self) => {
    const token = tokens[idx];
    const language = getCodeLanguage(`language-${token.info.trim()}`);
    if (!language) {
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
  return katex.renderToString(content, {
    displayMode,
    throwOnError: false,
  });
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
      )}" title="Copy code" type="button"><span class="zp-copy-icon"></span></button>`
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

function sanitizeMarkdownHtml(html: string): string {
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
      path: ["d"],
      span: ["aria-hidden", "class", "style"],
      svg: ["aria-hidden", "class", "focusable", "height", "viewbox", "width"],
    },
    allowedSchemes: ["http", "https", "mailto", "zotero"],
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "annotation",
      "button",
      "del",
      "input",
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
      "semantics",
      "svg",
    ],
  });
}

const markdownIt = createMarkdownIt();
