import sanitizeHtml from "sanitize-html";

declare const sanitizedMarkdownHtmlBrand: unique symbol;

export type SanitizedMarkdownHtml = string & {
  readonly [sanitizedMarkdownHtmlBrand]: true;
};

const SAFE_EXTERNAL_PROTOCOLS = new Set([
  "doi:",
  "http:",
  "https:",
  "mailto:",
  "zotero:",
]);

const KATEX_MATHML_TAGS = [
  "math",
  "annotation",
  "semantics",
  "mtext",
  "mn",
  "mo",
  "mi",
  "mspace",
  "mover",
  "munder",
  "munderover",
  "msup",
  "msub",
  "msubsup",
  "mfrac",
  "mroot",
  "msqrt",
  "mtable",
  "mtr",
  "mtd",
  "mlabeledtr",
  "mrow",
  "menclose",
  "mstyle",
  "mpadded",
  "mphantom",
  "mglyph",
] as const;

const KATEX_MATHML_ATTRIBUTES = [
  "accent",
  "accentunder",
  "alt",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "height",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "notation",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "valign",
  "voffset",
  "width",
] as const;

const KATEX_MATHML_ALLOWED_ATTRIBUTES = Object.fromEntries(
  KATEX_MATHML_TAGS.map((tag) => [tag, KATEX_MATHML_ATTRIBUTES]),
);

const MARKDOWN_HTML_TAGS = [
  "a",
  "blockquote",
  "br",
  "button",
  "code",
  "del",
  "div",
  "em",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "span",
  "strong",
  "sup",
  "svg",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const SAFE_CSS_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+)$/iu;
const SAFE_CSS_HEX_COLOR = /^#[0-9a-f]{3,8}$/iu;
const SAFE_CSS_LENGTH = /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|px))$/u;
const SAFE_CSS_LENGTH_PAIR =
  /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|px))(?: (?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|px)))?$/u;
const SAFE_CSS_TEXT_SHADOW =
  /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|px))(?: (?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:em|px))){2}$/u;

export function sanitizeMarkdownHtml(html: string): SanitizedMarkdownHtml {
  return sanitizeHtml(html, {
    allowProtocolRelative: false,
    allowedAttributes: {
      "*": ["class"],
      ...KATEX_MATHML_ALLOWED_ATTRIBUTES,
      a: ["href", "id", "rel", "target"],
      button: [
        "aria-label",
        "data-zp-copy-code",
        "title",
        { name: "type", values: ["button"] },
      ],
      input: ["checked", "disabled", { name: "type", values: ["checkbox"] }],
      li: ["id"],
      line: ["stroke-width", "x1", "x2", "y1", "y2"],
      path: ["d"],
      pre: [{ name: "tabindex", values: ["0"] }, "style"],
      rect: ["height", "rx", "ry", "width", "x", "y"],
      span: ["aria-hidden", "style", "title"],
      svg: [
        "aria-hidden",
        "data-icon-name",
        { name: "fill", values: ["currentColor", "none"] },
        "focusable",
        "height",
        "preserveaspectratio",
        { name: "stroke", values: ["currentColor", "none"] },
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-width",
        "viewbox",
        "width",
      ],
      td: ["style"],
      th: ["style"],
    },
    allowedStyles: {
      pre: {
        "--shiki-dark": [SAFE_CSS_HEX_COLOR],
        "--shiki-dark-bg": [SAFE_CSS_HEX_COLOR],
        "background-color": [SAFE_CSS_HEX_COLOR],
        color: [SAFE_CSS_HEX_COLOR],
      },
      span: {
        "--shiki-dark": [SAFE_CSS_HEX_COLOR],
        "--shiki-dark-font-style": [/^(?:italic|normal)$/u],
        "--shiki-dark-font-weight": [/^(?:bold|normal)$/u],
        "--shiki-light-font-style": [/^(?:italic|normal)$/u],
        "--shiki-light-font-weight": [/^(?:bold|normal)$/u],
        "background-color": [SAFE_CSS_COLOR],
        "border-bottom-width": [SAFE_CSS_LENGTH],
        "border-color": [SAFE_CSS_COLOR],
        "border-right-style": [/^(?:dashed|solid)$/u],
        "border-right-width": [SAFE_CSS_LENGTH],
        "border-style": [/^solid$/u],
        "border-top-width": [SAFE_CSS_LENGTH],
        "border-width": [SAFE_CSS_LENGTH],
        bottom: [SAFE_CSS_LENGTH],
        color: [SAFE_CSS_COLOR],
        height: [SAFE_CSS_LENGTH],
        left: [SAFE_CSS_LENGTH],
        margin: [SAFE_CSS_LENGTH_PAIR],
        "margin-left": [SAFE_CSS_LENGTH],
        "margin-right": [SAFE_CSS_LENGTH],
        "margin-top": [SAFE_CSS_LENGTH],
        "min-width": [SAFE_CSS_LENGTH],
        "padding-left": [SAFE_CSS_LENGTH],
        position: [/^relative$/u],
        "text-shadow": [SAFE_CSS_TEXT_SHADOW],
        top: [SAFE_CSS_LENGTH],
        "vertical-align": [SAFE_CSS_LENGTH],
        width: [SAFE_CSS_LENGTH],
      },
      td: {
        "text-align": [/^(?:center|left|right)$/u],
      },
      th: {
        "text-align": [/^(?:center|left|right)$/u],
      },
    },
    allowedSchemes: ["doi", "http", "https", "mailto", "zotero"],
    allowedTags: [
      ...MARKDOWN_HTML_TAGS,
      ...KATEX_MATHML_TAGS,
      "line",
      "path",
      "rect",
    ],
    transformTags: {
      a: normalizeMarkdownAnchor,
      button: normalizeCopyButton,
      input: normalizeTaskCheckbox,
    },
  }) as SanitizedMarkdownHtml;
}

export function isInternalMarkdownUrl(url: string): boolean {
  return url.startsWith("#");
}

export function isSafeExternalMarkdownUrl(url: string): boolean {
  if (!/^[A-Za-z][\w+.-]*:/u.test(url)) {
    return false;
  }
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function normalizeMarkdownAnchor(
  _tagName: string,
  attributes: Record<string, string>,
): sanitizeHtml.Tag {
  const { class: className, href, id } = attributes;
  const baseAttributes = compactAttributes({ class: className, id });
  if (!href) {
    return { tagName: "a", attribs: baseAttributes };
  }
  if (isInternalMarkdownUrl(href)) {
    return {
      tagName: "a",
      attribs: { ...baseAttributes, href },
    };
  }
  if (!isSafeExternalMarkdownUrl(href)) {
    return {
      tagName: "span",
      attribs: compactAttributes({ class: className }),
    };
  }
  return {
    tagName: "a",
    attribs: {
      ...baseAttributes,
      href,
      rel: "noopener noreferrer",
      target: "_blank",
    },
  };
}

function normalizeCopyButton(
  _tagName: string,
  attributes: Record<string, string>,
): sanitizeHtml.Tag {
  if (!attributes["data-zp-copy-code"]) {
    return {
      tagName: "span",
      attribs: compactAttributes({ class: attributes.class }),
    };
  }
  return {
    tagName: "button",
    attribs: {
      ...attributes,
      type: "button",
    },
  };
}

function normalizeTaskCheckbox(
  _tagName: string,
  attributes: Record<string, string>,
): sanitizeHtml.Tag {
  if (attributes.type !== "checkbox") {
    return {
      tagName: "span",
      attribs: compactAttributes({ class: attributes.class }),
    };
  }
  return {
    tagName: "input",
    attribs: {
      ...attributes,
      disabled: "disabled",
      type: "checkbox",
    },
  };
}

function compactAttributes(
  attributes: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/**
 * Zotero chrome documents are XML documents. Their `innerHTML` setter parses
 * XHTML fragments and runs Gecko's privileged sanitizer, which destroys
 * embedded MathML, SVG, and form controls. `setHTMLUnsafe` deliberately uses
 * the HTML fragment parser instead. Its input is restricted to markup that
 * has passed `sanitizeMarkdownHtml`.
 */
export function replaceSanitizedMarkdownHtml(
  element: HTMLDivElement,
  html: SanitizedMarkdownHtml,
): void {
  element.setHTMLUnsafe(html);
}
