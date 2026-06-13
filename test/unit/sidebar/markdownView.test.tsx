import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownView } from "../../../src/modules/sidebar/app/MarkdownView.tsx";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <MarkdownView markdown={markdown} onOpenLink={() => undefined} />,
  );
}

describe("MarkdownView", function () {
  it("renders CommonMark and GFM block elements compactly", function () {
    const html = renderMarkdown(
      [
        "# Title",
        "",
        "Paragraph with **bold**, *italic*, and ~~deleted~~.",
        "",
        "> quoted",
        "",
        "---",
      ].join("\n"),
    );

    assert.include(html, 'class="zcp-markdown-heading zcp-markdown-heading-1"');
    assert.include(html, "<strong>bold</strong>");
    assert.include(html, "<em>italic</em>");
    assert.include(html, "<del>deleted</del>");
    assert.include(html, "<blockquote>");
    assert.include(html, "<hr/>");
  });

  it("renders nested lists and read-only GFM task list checkboxes", function () {
    const html = renderMarkdown(
      ["1. Ordered", "   - Nested", "", "- [x] Done", "- [ ] Todo"].join("\n"),
    );

    assert.include(html, "<ol>");
    assert.include(html, "<ul>");
    assert.include(html, "Nested");
    assert.include(html, 'type="checkbox"');
    assert.include(html, 'readOnly=""');
    assert.include(html, 'class="zcp-task-checkbox"');
  });

  it("wraps GFM tables in a horizontal scroll container", function () {
    const html = renderMarkdown(
      [
        "| Column | Long |",
        "| --- | --- |",
        "| A | very-long-cell-that-should-not-expand-the-panel |",
      ].join("\n"),
    );

    assert.include(html, 'class="zcp-table-scroll"');
    assert.include(html, "<table>");
    assert.include(html, "very-long-cell");
  });

  it("renders fenced code with copy controls, labels, and highlight classes", function () {
    const html = renderMarkdown(
      ["```typescript", "const answer: number = 42;", "```"].join("\n"),
    );

    assert.include(html, 'class="zcp-code-block"');
    assert.include(html, 'class="zcp-code-language"');
    assert.include(html, ">typescript<");
    assert.include(html, 'aria-label="Copy code"');
    assert.include(html, 'class="hljs language-typescript"');
    assert.include(html, "hljs-keyword");
  });

  it("renders inline code, links, and autolinks", function () {
    const html = renderMarkdown(
      "Use `code`, [Zotero](zotero://select/items/ABC), and https://example.com.",
    );

    assert.include(html, "<code>code</code>");
    assert.include(html, 'href="zotero://select/items/ABC"');
    assert.include(html, 'href="https://example.com"');
  });

  it("renders inline and block math with KaTeX", function () {
    const html = renderMarkdown(
      ["Inline $x^2$.", "", "$$", "y = mx + b", "$$"].join("\n"),
    );

    assert.include(html, "katex");
    assert.include(html, "katex-display");
    assert.include(html, "x");
    assert.include(html, "y");
  });

  it("renders GFM footnotes", function () {
    const html = renderMarkdown(
      ["A footnote.[^a]", "", "[^a]: Footnote body"].join("\n"),
    );

    assert.include(html, 'data-footnotes="true"');
    assert.include(html, 'href="#user-content-fn-a"');
    assert.include(html, "Footnote body");
  });

  it("skips raw HTML", function () {
    const html = renderMarkdown('<script>alert("x")</script><b>raw</b>');

    assert.notInclude(html, "<script>");
    assert.notInclude(html, "<b>raw</b>");
    assert.notInclude(html, "alert");
  });

  it("does not render unsafe javascript links as anchors", function () {
    const html = renderMarkdown("[bad](javascript:alert(1))");

    assert.notInclude(html, 'href="javascript:alert(1)"');
    assert.include(html, 'class="zcp-unsafe-link"');
    assert.include(html, "bad");
  });

  it("renders Markdown images as links instead of loading img elements", function () {
    const html = renderMarkdown("![Preview](https://example.com/image.png)");

    assert.notInclude(html, "<img");
    assert.include(html, 'class="zcp-markdown-image"');
    assert.include(html, "Preview");
    assert.include(html, 'href="https://example.com/image.png"');
  });
});
