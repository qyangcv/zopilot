import { HTML_NS } from "./constants";

export { renderMarkdown };

function renderMarkdown(
  doc: Document,
  container: HTMLElement,
  markdown: string,
): void {
  container.replaceChildren();
  const lines = markdown.trim().split(/\r?\n/);
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
      const pre = doc.createElementNS(HTML_NS, "pre");
      const code = doc.createElementNS(HTML_NS, "code");
      code.textContent = codeLines.join("\n");
      pre.appendChild(code);
      container.appendChild(pre);
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
      const block = doc.createElementNS(HTML_NS, "div");
      block.className = "zcp-math-block";
      block.textContent = mathLines.join("\n");
      container.appendChild(block);
      continue;
    }

    if (isTableStart(lines, index)) {
      container.appendChild(renderTable(doc, lines, index));
      index += getTableRowCount(lines, index);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const list = doc.createElementNS(HTML_NS, "ul");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInline(doc, item, lines[index].replace(/^\s*[-*]\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = doc.createElementNS(HTML_NS, "ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = doc.createElementNS(HTML_NS, "li");
        appendInline(doc, item, lines[index].replace(/^\s*\d+\.\s+/, ""));
        list.appendChild(item);
        index += 1;
      }
      container.appendChild(list);
      continue;
    }

    const paragraph = doc.createElementNS(HTML_NS, "p");
    appendInline(doc, paragraph, line);
    container.appendChild(paragraph);
    index += 1;
  }
}

function renderTable(doc: Document, lines: string[], index: number): Element {
  const table = doc.createElementNS(HTML_NS, "table");
  const headerCells = splitTableRow(lines[index]);
  const bodyRows: string[][] = [];
  index += 2;
  while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
    bodyRows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const thead = doc.createElementNS(HTML_NS, "thead");
  const headerRow = doc.createElementNS(HTML_NS, "tr");
  headerCells.forEach((cell) => {
    const th = doc.createElementNS(HTML_NS, "th");
    appendInline(doc, th, cell);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = doc.createElementNS(HTML_NS, "tbody");
  bodyRows.forEach((row) => {
    const tr = doc.createElementNS(HTML_NS, "tr");
    row.forEach((cell) => {
      const td = doc.createElementNS(HTML_NS, "td");
      appendInline(doc, td, cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function getTableRowCount(lines: string[], index: number): number {
  let count = 2;
  index += 2;
  while (index < lines.length && /^\s*\|.+\|\s*$/.test(lines[index])) {
    count += 1;
    index += 1;
  }
  return count;
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

function appendInline(doc: Document, parent: Element, text: string): void {
  const tokenPattern =
    /(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\$[^$]+\$|\\\([^)]+\\\))/g;
  let lastIndex = 0;
  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > lastIndex) {
      parent.appendChild(
        doc.createTextNode(text.slice(lastIndex, match.index)),
      );
    }
    parent.appendChild(createInlineNode(doc, match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(doc.createTextNode(text.slice(lastIndex)));
  }
}

function createInlineNode(doc: Document, token: string): Node {
  if (token.startsWith("[")) {
    const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (match) {
      const anchor = doc.createElementNS(HTML_NS, "a");
      anchor.textContent = match[1];
      anchor.setAttribute("href", match[2]);
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      return anchor;
    }
  }
  if (token.startsWith("`")) {
    const code = doc.createElementNS(HTML_NS, "code");
    code.textContent = token.slice(1, -1);
    return code;
  }
  if (token.startsWith("**")) {
    const strong = doc.createElementNS(HTML_NS, "strong");
    strong.textContent = token.slice(2, -2);
    return strong;
  }
  if (token.startsWith("$")) {
    return createInlineMath(doc, token.slice(1, -1));
  }
  if (token.startsWith("\\(")) {
    return createInlineMath(doc, token.slice(2, -2));
  }
  return doc.createTextNode(token);
}

function createInlineMath(doc: Document, text: string): HTMLElement {
  const math = doc.createElementNS(HTML_NS, "span") as HTMLElement;
  math.className = "zcp-math-inline";
  math.textContent = text;
  return math;
}
