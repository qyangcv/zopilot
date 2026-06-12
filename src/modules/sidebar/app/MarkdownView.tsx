import { useState, type ReactElement, type ReactNode } from "react";

type MarkdownViewProps = {
  markdown: string;
  onOpenLink: (url: string) => void;
};

type Block =
  | { type: "code"; content: string }
  | { type: "math"; content: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "p"; content: string };

export function MarkdownView({
  markdown,
  onOpenLink,
}: MarkdownViewProps): ReactElement {
  const blocks = parseMarkdown(markdown);
  return (
    <>
      {blocks.map((block, index) => (
        <MarkdownBlock
          block={block}
          key={`${block.type}-${index}`}
          onOpenLink={onOpenLink}
        />
      ))}
    </>
  );
}

function MarkdownBlock({
  block,
  onOpenLink,
}: {
  block: Block;
  onOpenLink: (url: string) => void;
}): ReactElement {
  switch (block.type) {
    case "code":
      return <CodeBlock text={block.content} />;
    case "math":
      return <div className="zcp-math-block">{block.content}</div>;
    case "table":
      return (
        <table>
          <thead>
            <tr>
              {block.header.map((cell, index) => (
                <th key={index}>{renderInline(cell, onOpenLink)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{renderInline(cell, onOpenLink)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "ul":
      return (
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, onOpenLink)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol>
          {block.items.map((item, index) => (
            <li key={index}>{renderInline(item, onOpenLink)}</li>
          ))}
        </ol>
      );
    case "p":
      return <p>{renderInline(block.content, onOpenLink)}</p>;
  }
}

function CodeBlock({ text }: { text: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <div className="zcp-code-block">
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
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.trim().split(/\r?\n/);
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", content: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith("$$")) {
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("$$")) {
        mathLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "math", content: mathLines.join("\n") });
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    blocks.push({ type: "p", content: line });
    index += 1;
  }

  return blocks.length ? blocks : [{ type: "p", content: "" }];
}

function renderInline(
  text: string,
  onOpenLink: (url: string) => void,
): ReactNode[] {
  const tokenPattern =
    /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\$[^$]+\$|\\\([^)]+\\\))/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(createInlineNode(match[0], nodes.length, onOpenLink));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function createInlineNode(
  token: string,
  key: number,
  onOpenLink: (url: string) => void,
): ReactNode {
  if (token.startsWith("[")) {
    const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      return (
        <a
          href={match[2]}
          key={key}
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(match[2]);
          }}
          rel="noopener noreferrer"
          target="_blank"
        >
          {match[1]}
        </a>
      );
    }
  }
  if (token.startsWith("`")) {
    return <code key={key}>{token.slice(1, -1)}</code>;
  }
  if (token.startsWith("**")) {
    return <strong key={key}>{token.slice(2, -2)}</strong>;
  }
  if (token.startsWith("$")) {
    return (
      <span className="zcp-math-inline" key={key}>
        {token.slice(1, -1)}
      </span>
    );
  }
  if (token.startsWith("\\(")) {
    return (
      <span className="zcp-math-inline" key={key}>
        {token.slice(2, -2)}
      </span>
    );
  }
  return token;
}

function isTableStart(lines: string[], index: number): boolean {
  return (
    /^\s*\|.+\|\s*$/.test(lines[index]) &&
    index + 1 < lines.length &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
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
