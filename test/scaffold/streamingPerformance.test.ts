import { assert } from "chai";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveStreamingMessage } from "../../src/features/sidebar/ui/ActiveStreamingMessage";
import { MarkdownView } from "../../src/features/sidebar/ui/MarkdownView";
import { Message } from "../../src/features/sidebar/ui/Message";
import { SidebarStreamSnapshotStore } from "../../src/features/sidebar/ui/SidebarStreamSnapshotStore";
import { StreamingMarkdownView } from "../../src/features/sidebar/ui/StreamingMarkdownView";
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
    if (!win) return;
    const doc = win.document;
    const fixture = createFixture(doc);
    let root: Root | undefined;
    setSidebarPerformanceMetricsEnabled(true);

    try {
      const markdown = createLongMarkdown();
      const scrollContainer = fixture;
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
      const mounted = await waitForCondition(
        win,
        () => reactMount.querySelector(".zp-markdown-rendered") !== null,
        5_000,
      );
      assert.isTrue(mounted, "initial Markdown render mounted");
      const renderedContent = reactMount.querySelector(
        ".zp-markdown-rendered",
      ) as HTMLElement | null;
      assert.exists(renderedContent, "rendered Markdown content");
      if (!renderedContent) return;
      measureSidebarPerformance(
        "markdown.layout",
        { textLength: markdown.length },
        () => {
          void renderedContent.getBoundingClientRect().height;
          void scrollContainer.scrollHeight;
        },
      );
      measureSidebarPerformance("scroll.sync", {}, () => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
      root.render(
        createElement(MarkdownView, {
          markdown: `${markdown}\n\nFinal appended paragraph.`,
          onOpenLink: () => undefined,
        }),
      );
      const updated = await waitForCondition(
        win,
        () =>
          reactMount.textContent?.includes("Final appended paragraph.") ===
          true,
        5_000,
      );
      assert.isTrue(updated, "updated Markdown render committed");

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

  it("mounts and updates a message without privileged sanitizer warnings", async function () {
    this.timeout(30_000);
    const win = Zotero.getMainWindow();
    if (!win) return;
    const fixture = createFixture(win.document);
    const reactMount = fixture.querySelector(
      "[data-react-mount]",
    ) as HTMLElement;
    const root = createRoot(reactMount);
    const innerWindowId = win.windowGlobalChild?.innerWindowId;
    assert.isNumber(innerWindowId, "current Gecko inner window ID");
    if (typeof innerWindowId !== "number") return;
    const sanitizerWarnings: string[] = [];
    let openedUrl: string | undefined;
    const listener: nsIConsoleListener = (message) => {
      let error: nsIScriptError;
      try {
        error = message.QueryInterface(Ci.nsIScriptError) as nsIScriptError;
      } catch {
        return;
      }
      if (error.category !== "DOM" || error.innerWindowID !== innerWindowId) {
        return;
      }
      if (
        /(?:Flattening|Removing) unsafe node|Removed unsafe (?:attribute|URI)|Removed some rules and\/or properties from stylesheet/u.test(
          error.errorMessage,
        )
      ) {
        sanitizerWarnings.push(
          `${error.errorMessage} (${error.sourceName}:${error.lineNumber})`,
        );
      }
    };
    Services.console.registerListener(listener);

    try {
      const markdown = [
        String.raw`Boundary sentinel $\sqrt[3]{x^2}+1$.`,
        "",
        "[Open](https://example.com)",
        "",
        "- [x] Complete",
        "",
        "Footnote.[^a]",
        "",
        "[^a]: Native target",
        "",
        "```typescript",
        "const value = 1;",
        "```",
      ].join("\n");
      root.render(
        createElement(Message, {
          busy: false,
          copiedId: null,
          message: {
            id: "markdown-boundary",
            role: "assistant",
            status: "complete",
            text: markdown,
          },
          onCopy: () => undefined,
          onEdit: () => undefined,
          onOpenLink: (url: string) => {
            openedUrl = url;
          },
          onSubmit: () => undefined,
        }),
      );
      await waitForCondition(
        win,
        () => reactMount.querySelector("math mroot") !== null,
      );
      await waitForFrames(win, 2);

      const markdownRoot = reactMount.querySelector(
        ".zp-message-markdown",
      ) as HTMLElement;
      const xhtmlNamespace = "http://www.w3.org/1999/xhtml";
      const mathmlNamespace = "http://www.w3.org/1998/Math/MathML";
      const svgNamespace = "http://www.w3.org/2000/svg";
      assert.equal(markdownRoot.namespaceURI, xhtmlNamespace);
      for (const selector of ["p", "span", "button", "input"]) {
        const element = markdownRoot.querySelector(selector);
        assert.exists(element, selector);
        assert.equal(element?.namespaceURI, xhtmlNamespace, selector);
      }
      for (const selector of [
        "math",
        "semantics",
        "mrow",
        "mroot",
        "msup",
        "mi",
        "mn",
        "mo",
        "annotation",
      ]) {
        const element = markdownRoot.querySelector(selector);
        assert.exists(element, selector);
        assert.equal(element?.namespaceURI, mathmlNamespace, selector);
      }
      const copyButton = markdownRoot.querySelector(
        "button[data-zp-copy-code]",
      );
      assert.exists(copyButton);
      for (const selector of ["svg", "rect", "path"]) {
        const element = copyButton?.querySelector(selector);
        assert.exists(element, selector);
        assert.equal(element?.namespaceURI, svgNamespace, selector);
      }
      assert.equal(
        copyButton?.querySelector("svg")?.getAttribute("viewBox"),
        "0 0 24 24",
      );
      const checkbox = markdownRoot.querySelector(
        "input.zp-task-checkbox",
      ) as HTMLInputElement;
      assert.isTrue(checkbox.disabled);
      assert.isTrue(checkbox.checked);
      assert.exists(markdownRoot.querySelector("#footnote1"));
      assert.exists(markdownRoot.querySelector("#footnote-ref1"));
      assert.exists(markdownRoot.querySelector('a[href="#footnote-ref1"]'));

      const externalLink = markdownRoot.querySelector(
        'a[href="https://example.com"]',
      ) as HTMLAnchorElement;
      assert.exists(externalLink);
      externalLink.dispatchEvent(
        new win.MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      assert.equal(openedUrl, "https://example.com");

      root.render(
        createElement(Message, {
          busy: false,
          copiedId: null,
          message: {
            id: "markdown-boundary",
            role: "assistant",
            status: "complete",
            text: `${markdown}\n\nUpdated $\\frac{a}{b}$.`,
          },
          onCopy: () => undefined,
          onEdit: () => undefined,
          onOpenLink: () => undefined,
          onSubmit: () => undefined,
        }),
      );
      await waitForCondition(
        win,
        () =>
          markdownRoot.textContent?.includes("Updated") === true &&
          markdownRoot.querySelector("math mfrac") !== null,
      );
      await waitForFrames(win, 2);
      assert.include(markdownRoot.textContent, "Boundary sentinel");
      assert.deepEqual(sanitizerWarnings, []);
    } finally {
      Services.console.unregisterListener(listener);
      root.unmount();
      fixture.remove();
    }
  });

  it("preserves stable Markdown DOM and only sanitizes the active tail", async function () {
    this.timeout(30_000);
    const win = Zotero.getMainWindow();
    if (!win) return;
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
    if (!win) return;
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
  const reactMount = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
  reactMount.setAttribute("data-react-mount", "");
  fixture.append(reactMount);
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
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>((resolve) => win.setTimeout(resolve, 10));
  }
  return condition();
}
