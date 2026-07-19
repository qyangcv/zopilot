import { assert } from "chai";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveStreamingMessage } from "../../src/features/sidebar/ui/ActiveStreamingMessage";
import { MarkdownView } from "../../src/features/sidebar/ui/MarkdownView";
import { SidebarStreamSnapshotStore } from "../../src/features/sidebar/ui/SidebarStreamSnapshotStore";
import { StreamingMarkdownView } from "../../src/features/sidebar/ui/StreamingMarkdownView";
import { renderMarkdownToHtml } from "../../src/features/sidebar/ui/markdownRenderer";
import {
  getSidebarPerformanceReport,
  measureSidebarPerformance,
  resetSidebarPerformanceMetrics,
  setSidebarPerformanceMetricsEnabled,
  type SidebarPerformanceMetricName,
} from "../../src/features/sidebar/ui/performanceMetrics";

describe("streaming performance attribution integration", function () {
  it("measures Markdown, DOM replacement, layout, React commit, and scrolling in Gecko", async function () {
    this.timeout(30_000);
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;
    const fixture = createFixture(doc);
    let root: Root | undefined;
    setSidebarPerformanceMetricsEnabled(true);

    try {
      const markdown = createLongMarkdown();
      const html = renderMarkdownToHtml(markdown);
      const directContent = fixture.querySelector(
        "[data-direct-content]",
      ) as HTMLElement;
      const scrollContainer = fixture;

      measureSidebarPerformance(
        "markdown.domReplace",
        { textLength: markdown.length },
        () => {
          directContent.innerHTML = html;
        },
      );
      measureSidebarPerformance(
        "markdown.layout",
        { textLength: markdown.length },
        () => {
          void directContent.getBoundingClientRect().height;
          void scrollContainer.scrollHeight;
        },
      );
      measureSidebarPerformance("scroll.sync", {}, () => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });

      const reactMount = fixture.querySelector(
        "[data-react-mount]",
      ) as HTMLElement;
      root = createRoot(reactMount);
      root.render(
        createElement(MarkdownView, {
          markdown,
          onOpenLink: () => undefined,
        }),
      );
      await waitForFrames(win, 2);
      root.render(
        createElement(MarkdownView, {
          markdown: `${markdown}\n\nFinal appended paragraph.`,
          onOpenLink: () => undefined,
        }),
      );
      await waitForFrames(win, 2);

      const report = getSidebarPerformanceReport();
      for (const name of [
        "markdown.total",
        "markdown.parse",
        "markdown.render",
        "markdown.sanitize",
        "markdown.shiki",
        "markdown.katex",
        "markdown.domReplace",
        "markdown.layout",
        "markdown.reactCommit",
        "scroll.sync",
      ] satisfies SidebarPerformanceMetricName[]) {
        assert.isAtLeast(report[name]?.count ?? 0, 1, name);
        assert.isAtLeast(report[name]?.totalMs ?? -1, 0, name);
      }
      (
        globalThis as typeof globalThis & {
          debug?: (data: unknown) => void;
        }
      ).debug?.({
        label: "Zopilot streaming performance attribution",
        report,
      });
    } finally {
      root?.unmount();
      fixture.remove();
      setSidebarPerformanceMetricsEnabled(false);
    }
  });

  it("preserves stable Markdown DOM and only sanitizes the active tail", async function () {
    this.timeout(30_000);
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const fixture = createFixture(win.document);
    const reactMount = fixture.querySelector(
      "[data-react-mount]",
    ) as HTMLElement;
    const root = createRoot(reactMount);
    const onOpenLink = () => undefined;
    const initial = `${createLongMarkdown()}\n\nActive tail.`;
    setSidebarPerformanceMetricsEnabled(true);

    try {
      root.render(
        createElement(StreamingMarkdownView, {
          markdown: initial,
          onOpenLink,
        }),
      );
      await waitForCondition(
        win,
        () =>
          reactMount.querySelectorAll("[data-zp-markdown-segment]").length > 24,
      );
      const initialSegments = [
        ...reactMount.querySelectorAll("[data-zp-markdown-segment]"),
      ];
      assert.isAbove(initialSegments.length, 24);

      resetSidebarPerformanceMetrics();
      const updatedMarkdown = `${initial} More text.`;
      root.render(
        createElement(StreamingMarkdownView, {
          markdown: updatedMarkdown,
          onOpenLink,
        }),
      );
      await waitForCondition(win, () => {
        const segments = [
          ...reactMount.querySelectorAll("[data-zp-markdown-segment]"),
        ];
        return segments.at(-1)?.textContent?.includes("More text.") ?? false;
      });

      const updatedSegments = [
        ...reactMount.querySelectorAll("[data-zp-markdown-segment]"),
      ];
      assert.lengthOf(updatedSegments, initialSegments.length);
      assert.strictEqual(updatedSegments[0], initialSegments[0]);
      assert.strictEqual(updatedSegments.at(-2), initialSegments.at(-2));
      assert.strictEqual(updatedSegments.at(-1), initialSegments.at(-1));
      assert.include(updatedSegments.at(-1)?.textContent, "More text.");

      const report = getSidebarPerformanceReport();
      assert.equal(report["markdown.segment"]?.count, 1);
      assert.equal(report["markdown.parse"]?.count, 1);
      assert.equal(report["markdown.render"]?.count, 1);
      assert.equal(report["markdown.sanitize"]?.count, 1);
      assert.equal(report["markdown.reactCommit"]?.count, 1);
      assert.isAbove(
        report["markdown.segment"]?.samples[0]?.textLength ?? 0,
        5_000,
      );
      (
        globalThis as typeof globalThis & {
          debug?: (data: unknown) => void;
        }
      ).debug?.({
        label: "Zopilot stable streaming Markdown attribution",
        report,
      });
    } finally {
      root.unmount();
      fixture.remove();
      setSidebarPerformanceMetricsEnabled(false);
    }
  });

  it("does not synchronize scrolling for lifecycle-only snapshots", async function () {
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const fixture = createFixture(win.document);
    const reactMount = fixture.querySelector(
      "[data-react-mount]",
    ) as HTMLElement;
    const root = createRoot(reactMount);
    const streamStore = new SidebarStreamSnapshotStore();
    let scrollSyncs = 0;
    const createSnapshot = (
      lifecycle: "running" | "completed",
      revision: number,
      text: string,
    ) => ({
      conversationId: "scroll-conversation",
      messageId: "scroll-message",
      lifecycle,
      stateVersion: revision,
      finalStarted: true,
      answerBlocks: [
        {
          id: "answer",
          type: "content" as const,
          phase: "final_answer" as const,
          text,
          revision,
        },
      ],
      traceBlocks: [],
    });

    try {
      streamStore.publish(createSnapshot("running", 1, "Stable answer."));
      root.render(
        createElement(ActiveStreamingMessage, {
          conversationId: "scroll-conversation",
          models: [],
          onOpenLink: () => undefined,
          streamStore,
          syncScroll: () => {
            scrollSyncs += 1;
          },
        }),
      );
      await waitForFrames(win, 2);
      assert.equal(scrollSyncs, 1);

      streamStore.publish(createSnapshot("completed", 1, "Stable answer."));
      await waitForFrames(win, 2);
      assert.equal(scrollSyncs, 1);

      streamStore.publish(
        createSnapshot("completed", 2, "Stable answer. Appended."),
      );
      await waitForFrames(win, 2);
      assert.equal(scrollSyncs, 2);
    } finally {
      root.unmount();
      fixture.remove();
      streamStore.clear();
    }
  });
});

function createFixture(doc: Document): HTMLElement {
  const fixture = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  ) as HTMLElement;
  fixture.setAttribute(
    "style",
    [
      "position: fixed",
      "left: -10000px",
      "top: 0",
      "width: 360px",
      "height: 320px",
      "overflow: auto",
      "opacity: 0",
      "pointer-events: none",
    ].join(";"),
  );
  fixture.setAttribute("data-scroll-container", "");
  const directContent = doc.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "div",
  );
  directContent.setAttribute("data-direct-content", "");
  const reactMount = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  reactMount.setAttribute("data-react-mount", "");
  fixture.append(directContent, reactMount);
  doc.documentElement.append(fixture);
  return fixture;
}

function createLongMarkdown(): string {
  return Array.from({ length: 24 }, (_, index) =>
    [
      `## Section ${index + 1}`,
      "",
      "A streaming paragraph with **bold text**, a [link](https://example.com), and enough words to exercise line wrapping and layout.",
      "",
      `Inline formula $x_${index}^2 + y_${index}^2 = z_${index}^2$.`,
      "",
      "```typescript",
      `const section${index} = ${index};`,
      "```",
    ].join("\n"),
  ).join("\n\n");
}

async function waitForFrames(win: Window, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) =>
      win.requestAnimationFrame(() => resolve()),
    );
  }
}

async function waitForCondition(
  win: Window,
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => win.setTimeout(resolve, 10));
  }
}
