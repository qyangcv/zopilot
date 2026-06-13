import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import latex from "highlight.js/lib/languages/latex";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

type MarkdownViewProps = {
  markdown: string;
  onOpenLink: (url: string) => void;
};

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "zotero:"]);

const LANGUAGE_ALIASES = new Map([
  ["js", "javascript"],
  ["jsx", "javascript"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["py", "python"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["zsh", "bash"],
  ["html", "xml"],
  ["md", "markdown"],
  ["tex", "latex"],
]);

registerHighlightLanguages();

export function MarkdownView({
  markdown,
  onOpenLink,
}: MarkdownViewProps): ReactElement {
  const components = useMemo(
    () => createMarkdownComponents(onOpenLink),
    [onOpenLink],
  );

  return (
    <ReactMarkdown
      components={components}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      remarkPlugins={[remarkGfm, remarkMath]}
      skipHtml
      urlTransform={(url) =>
        isInternalUrl(url) || isSafeExternalUrl(url) ? url : ""
      }
    >
      {markdown}
    </ReactMarkdown>
  );
}

function createMarkdownComponents(
  onOpenLink: (url: string) => void,
): Components {
  return {
    a({ children, href }) {
      if (!href) {
        return <span className="zcp-unsafe-link">{children}</span>;
      }
      if (isInternalUrl(href)) {
        return <a href={href}>{children}</a>;
      }
      if (!isSafeExternalUrl(href)) {
        return <span className="zcp-unsafe-link">{children}</span>;
      }
      return (
        <a
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(href);
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          {children}
        </a>
      );
    },
    blockquote({ children }) {
      return <blockquote>{children}</blockquote>;
    },
    code({ children, className }) {
      const text = String(children).replace(/\n$/u, "");
      const language = getCodeLanguage(className);
      if (!language) {
        return <code>{children}</code>;
      }
      return <CodeBlock language={language} text={text} />;
    },
    h1({ children }) {
      return (
        <h2 className="zcp-markdown-heading zcp-markdown-heading-1">
          {children}
        </h2>
      );
    },
    h2({ children }) {
      return (
        <h3 className="zcp-markdown-heading zcp-markdown-heading-2">
          {children}
        </h3>
      );
    },
    h3({ children }) {
      return (
        <h4 className="zcp-markdown-heading zcp-markdown-heading-3">
          {children}
        </h4>
      );
    },
    h4({ children }) {
      return (
        <h5 className="zcp-markdown-heading zcp-markdown-heading-4">
          {children}
        </h5>
      );
    },
    h5({ children }) {
      return (
        <h6 className="zcp-markdown-heading zcp-markdown-heading-5">
          {children}
        </h6>
      );
    },
    h6({ children }) {
      return (
        <h6 className="zcp-markdown-heading zcp-markdown-heading-6">
          {children}
        </h6>
      );
    },
    img({ alt, src }) {
      const label = alt?.trim() ? alt : "image";
      if (!src || !isSafeExternalUrl(src)) {
        return (
          <span className="zcp-markdown-image">
            <span className="zcp-markdown-image-label">{label}</span>
          </span>
        );
      }
      return (
        <span className="zcp-markdown-image">
          <span className="zcp-markdown-image-label">{label}</span>{" "}
          <a
            href={src}
            onClick={(event) => {
              event.preventDefault();
              onOpenLink(src);
            }}
            rel="noopener noreferrer"
            target="_blank"
          >
            {src}
          </a>
        </span>
      );
    },
    input({ checked, type }) {
      if (type !== "checkbox") {
        return <input checked={checked} readOnly type={type} />;
      }
      return (
        <input
          checked={Boolean(checked)}
          className="zcp-task-checkbox"
          readOnly
          type="checkbox"
        />
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    table({ children }) {
      return (
        <div className="zcp-table-scroll">
          <table>{children}</table>
        </div>
      );
    },
  };
}

function CodeBlock({
  language,
  text,
}: {
  language: string;
  text: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const highlighted = highlightCode(text, language);

  return (
    <div className="zcp-code-block">
      <div className="zcp-code-header">
        <span className="zcp-code-language">{language}</span>
        <button
          aria-label="Copy code"
          className="zcp-inline-copy"
          onClick={() => {
            void copyText(text).then(() => {
              setCopied(true);
              globalThis.setTimeout(() => setCopied(false), 900);
            });
          }}
          title="Copy code"
          type="button"
        >
          <span className={copied ? "zcp-check-icon" : "zcp-copy-icon"} />
        </button>
      </div>
      <pre>
        <code
          className={`hljs language-${language}`}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

function registerHighlightLanguages(): void {
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("markdown", markdownLanguage);
  hljs.registerLanguage("latex", latex);
}

function getCodeLanguage(className?: string): string | undefined {
  const match = /(?:^|\s)language-([\w-]+)/u.exec(className ?? "");
  if (!match) {
    return undefined;
  }
  const rawLanguage = match[1].toLowerCase();
  return LANGUAGE_ALIASES.get(rawLanguage) ?? rawLanguage;
}

function highlightCode(text: string, language: string): string {
  if (!hljs.getLanguage(language)) {
    return escapeHtml(text);
  }
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}

function isInternalUrl(url: string): boolean {
  return url.startsWith("#");
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function copyText(text: string): Promise<void> {
  const nav = (globalThis as typeof globalThis & { navigator?: Navigator })
    .navigator;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  const doc = getDocument();
  if (!doc?.body) {
    return;
  }
  const textarea = doc.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  doc.body.append(textarea);
  textarea.select();
  doc.execCommand("copy");
  textarea.remove();
}

function getDocument(): Document | undefined {
  return (globalThis as typeof globalThis & { document?: Document }).document;
}
