import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getCodeLanguage,
  highlightCodeWithShiki,
} from "../../../src/features/sidebar/ui/codeHighlighting.ts";
import { MarkdownView } from "../../../src/features/sidebar/ui/MarkdownView.tsx";
import { StreamingMarkdownView } from "../../../src/features/sidebar/ui/StreamingMarkdownView.tsx";
import {
  renderMarkdownToHtml,
  splitStreamingMarkdown,
} from "../../../src/features/sidebar/ui/markdownRenderer.ts";
import {
  getSidebarPerformanceReport,
  setSidebarPerformanceMetricsEnabled,
} from "../../../src/features/sidebar/ui/performanceMetrics.ts";

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    <MarkdownView markdown={markdown} onOpenLink={() => undefined} />,
  );
}

describe("MarkdownView", function () {
  it("splits streaming Markdown at stable top-level block boundaries", function () {
    const segments = splitStreamingMarkdown(
      [
        "First paragraph.",
        "",
        "- first item",
        "",
        "- second item",
        "",
        "Active tail.",
      ].join("\n"),
    );

    assert.deepEqual(
      segments.map((segment) => segment.text),
      [
        "First paragraph.\n\n",
        "- first item\n\n- second item\n\n",
        "Active tail.",
      ],
    );
  });

  it("keeps fenced code intact and falls back for cross-block references", function () {
    const codeSegments = splitStreamingMarkdown(
      [
        "Before.",
        "",
        "```typescript",
        "const value = 1;",
        "```",
        "",
        "After.",
      ].join("\n"),
    );
    assert.lengthOf(codeSegments, 3);
    assert.include(codeSegments[1]?.text ?? "", "const value = 1;");

    const referenceMarkdown = [
      "See [the source][source].",
      "",
      "[source]: https://example.com",
    ].join("\n");
    assert.deepEqual(splitStreamingMarkdown(referenceMarkdown), [
      { id: "all", text: referenceMarkdown },
    ]);
  });

  it("renders streaming segments under one Markdown container", function () {
    const html = renderToStaticMarkup(
      <StreamingMarkdownView
        className="zp-message-markdown"
        markdown={"Stable.\n\nActive."}
        onOpenLink={() => undefined}
      />,
    );

    assert.include(html, 'data-zp-streaming-markdown=""');
    assert.equal((html.match(/data-zp-markdown-segment=/gu) ?? []).length, 2);
    assert.include(html, "Stable.");
    assert.include(html, "Active.");
  });

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

    assert.include(html, 'class="zp-markdown-heading zp-markdown-heading-1"');
    assert.include(html, "<strong>bold</strong>");
    assert.include(html, "<em>italic</em>");
    assert.include(html, "<del>deleted</del>");
    assert.include(html, "<blockquote>");
    assert.include(html, "<hr");
  });

  it("renders nested lists and read-only GFM task list checkboxes", function () {
    const html = renderMarkdown(
      ["1. Ordered", "   - Nested", "", "- [x] Done", "- [ ] Todo"].join("\n"),
    );

    assert.include(html, "<ol>");
    assert.include(html, "<ul>");
    assert.include(html, "Nested");
    assert.include(html, 'type="checkbox"');
    assert.include(html, 'disabled="disabled"');
    assert.include(html, 'class="zp-task-checkbox"');
  });

  it("wraps GFM tables in a horizontal scroll container", function () {
    const html = renderMarkdown(
      [
        "| Column | Long |",
        "| --- | --- |",
        "| A | very-long-cell-that-should-not-expand-the-panel |",
      ].join("\n"),
    );

    assert.include(html, 'class="zp-table-scroll"');
    assert.include(html, "<table>");
    assert.include(html, "very-long-cell");
  });

  it("renders fenced code with floating copy controls and Shiki output", function () {
    const html = renderMarkdown(
      ["```typescript", "const answer: number = 42;", "```"].join("\n"),
    );

    assert.include(html, 'class="zp-code-block"');
    assert.notInclude(html, 'class="zp-code-language"');
    assert.include(html, 'aria-label="Copy code"');
    assert.include(html, 'class="zp-code-copy zp-inline-copy"');
    assert.include(html, 'data-icon-name="copy"');
    assert.notInclude(html, "zp-copy-icon");
    assert.include(html, 'class="zp-code-content"');
    assert.include(html, "shiki-themes github-light github-dark");
    assert.include(html, "--shiki-dark");
    assert.include(html, ">const</span>");
    assert.include(html, " answer</span>");
    assert.include(html, " 42</span>");
  });

  it("defers Shiki highlighting until a streaming code fence closes", function () {
    const html = renderMarkdown(
      ["```typescript", "const answer: number = 42;"].join("\n"),
    );

    assert.include(html, 'class="zp-code-plain"');
    assert.notInclude(html, 'class="zp-code-content"');
    assert.notInclude(html, "shiki-themes");
  });

  it("normalizes code fence language aliases", function () {
    assert.strictEqual(getCodeLanguage("language-py"), "python");
    assert.strictEqual(getCodeLanguage("language-jsx"), "jsx");
    assert.strictEqual(getCodeLanguage("language-tsx"), "tsx");
    assert.strictEqual(getCodeLanguage("language-zsh"), "bash");
    assert.strictEqual(getCodeLanguage("language-tex"), "latex");
  });

  it("highlights supported code blocks with Shiki dual themes", async function () {
    const html = await highlightCodeWithShiki(
      ["def answer(value):", "    return value + 42"].join("\n"),
      "python",
    );

    assert.isString(html);
    assert.include(html ?? "", "shiki-themes github-light github-dark");
    assert.include(html ?? "", "--shiki-dark");
    assert.include(html ?? "", "def");
    assert.notInclude(html ?? "", '</span>\n<span class="line"');
  });

  it("falls back for unsupported code block languages", async function () {
    const html = await highlightCodeWithShiki("plain", "made-up-language");

    assert.isUndefined(html);
  });

  it("renders empty and unlabelled code fences with XHTML-safe attributes", function () {
    const html = renderMarkdownToHtml(
      ["```", "plain", "```", "", "```", "```"].join("\n"),
    );

    assert.include(html, 'class="language-text"');
    assert.notInclude(html, "data-language");
    assert.notInclude(html, "data-zp-copy-code ");
    assert.notInclude(html, "data-zp-copy-code>");
  });

  it("renders inline code, links, and autolinks", function () {
    const html = renderMarkdown(
      "Use `code`, [Zotero](zotero://select/items/ABC), and https://example.com.",
    );

    assert.include(html, "<code>code</code>");
    assert.include(html, 'href="zotero://select/items/ABC"');
    assert.include(html, 'href="https://example.com"');
  });

  it("renders dollar-delimited inline and block math with KaTeX", function () {
    const html = renderMarkdown(
      ["Inline $x^2$.", "", "$$", "y = mx + b", "$$"].join("\n"),
    );

    assert.include(html, "katex");
    assert.include(html, "katex-display");
    assert.include(html, "x");
    assert.include(html, "y");
  });

  it("renders bracket-delimited math with KaTeX", function () {
    const html = renderMarkdown(
      ["Inline \\(x^2\\).", "", "\\[", "y = mx + b", "\\]"].join("\n"),
    );

    assert.include(html, "katex");
    assert.include(html, "katex-display");
    assert.include(html, "x");
    assert.include(html, "y");
  });

  it("renders mixed inline math delimiter styles", function () {
    const html = renderMarkdown("Inline $a$ and \\(b\\).");

    assert.include(html, "katex");
    assert.include(html, "a");
    assert.include(html, "b");
  });

  it("renders math fences with KaTeX", function () {
    const html = renderMarkdown(["```math", "y = mx + b", "```"].join("\n"));

    assert.include(html, "katex");
    assert.include(html, "katex-display");
    assert.include(html, "y");
  });

  it("reuses KaTeX results across repeated renders", function () {
    setSidebarPerformanceMetricsEnabled(true);
    try {
      const markdown = "Inline $cache_probe_{72831}$.";
      renderMarkdownToHtml(markdown);
      renderMarkdownToHtml(markdown);

      const report = getSidebarPerformanceReport();
      assert.equal(report["markdown.katex"]?.count, 1);
      assert.equal(report["markdown.katex.cacheHit"]?.count, 1);
    } finally {
      setSidebarPerformanceMetricsEnabled(false);
    }
  });

  it("bounds the KaTeX cache and evicts its oldest result", function () {
    setSidebarPerformanceMetricsEnabled(true);
    try {
      for (let index = 0; index < 129; index += 1) {
        renderMarkdownToHtml(`Inline $bounded_probe_${index}_{72831}$.`);
      }
      renderMarkdownToHtml("Inline $bounded_probe_0_{72831}$.");

      const report = getSidebarPerformanceReport();
      assert.equal(report["markdown.katex"]?.count, 130);
      assert.isUndefined(report["markdown.katex.cacheHit"]);
    } finally {
      setSidebarPerformanceMetricsEnabled(false);
    }
  });

  it("does not render math delimiters inside code", function () {
    const html = renderMarkdown(
      ["Inline `$x^2$`.", "", "```text", "$$y = mx + b$$", "```"].join("\n"),
    );

    assert.notInclude(html, "katex");
    assert.include(html, "<code>$x^2$</code>");
    assert.include(html, "$$y = mx + b$$");
  });

  it("renders GFM footnotes", function () {
    const html = renderMarkdown(
      ["A footnote.[^a]", "", "[^a]: Footnote body"].join("\n"),
    );

    assert.include(html, 'class="footnotes"');
    assert.include(html, 'href="#footnote1"');
    assert.include(html, "Footnote body");
  });

  it("skips raw HTML", function () {
    const html = renderMarkdown(
      '<script>alert("x")</script><b>raw</b><svg><path d="M0 0h1v1" /></svg>',
    );

    assert.notInclude(html, "<script>");
    assert.notInclude(html, "<b>raw</b>");
    assert.notInclude(html, "<svg");
    assert.notInclude(html, "alert");
  });

  it("does not render unsafe javascript links as anchors", function () {
    const html = renderMarkdown("[bad](javascript:alert(1))");

    assert.notInclude(html, 'href="javascript:alert(1)"');
    assert.include(html, 'class="zp-unsafe-link"');
    assert.include(html, "bad");
  });

  it("renders Markdown images as links instead of loading img elements", function () {
    const html = renderMarkdown("![Preview](https://example.com/image.png)");

    assert.notInclude(html, "<img");
    assert.include(html, 'class="zp-markdown-image"');
    assert.include(html, "Preview");
    assert.include(html, 'href="https://example.com/image.png"');
  });
});
