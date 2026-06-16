import { assert } from "chai";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Message,
  SidebarApp,
} from "../../../src/modules/sidebar/app/SidebarApp.tsx";
import type {
  SidebarActions,
  SidebarState,
} from "../../../src/modules/sidebar/app/types.ts";

describe("SidebarApp", function () {
  before(function () {
    installLocaleMock();
  });

  it("shows no assistant footer while a response is running", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          busy: true,
          messages: [
            {
              id: "running",
              role: "assistant",
              text: "Partial",
              status: "complete",
              transient: true,
              running: true,
            },
          ],
        })}
      />,
    );

    assert.include(html, 'aria-label="zopilot-sidebar-stop"');
    assert.include(html, 'data-icon-name="stop"');
    assert.notInclude(html, "zp-stop-icon");
    assert.notInclude(html, "zp-message-footer");
  });

  it("renders sent user messages with the shared Markdown view", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "user-markdown",
              role: "user",
              text: [
                "**bold**",
                "",
                "- item",
                "",
                "```typescript",
                "const answer = 42;",
                "```",
              ].join("\n"),
            },
          ],
        })}
      />,
    );

    assert.include(
      html,
      'class="zp-markdown-rendered zp-message-bubble zp-message-markdown"',
    );
    assert.include(html, "<strong>bold</strong>");
    assert.include(html, "<li>item</li>");
    assert.include(html, 'class="zp-code-block"');
    assert.notInclude(html, "**bold**");
  });

  it("keeps single-paragraph user bubbles compact", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "single-user-markdown",
              role: "user",
              text: "**bold** text",
            },
          ],
        })}
      />,
    );

    assert.include(
      html,
      'class="zp-markdown-rendered zp-message-bubble zp-message-markdown"',
    );
    assert.include(html, "<strong>bold</strong> text");
    assert.notInclude(html, "<p>");
  });

  it("keeps edit and resend actions bound to raw user text", function () {
    const rawText = "**raw** [link](https://example.com)";
    const inserted: string[] = [];
    const submitted: string[] = [];
    const element = Message({
      busy: false,
      copiedId: null,
      message: {
        id: "raw-user",
        role: "user",
        text: rawText,
      },
      onCopy: () => undefined,
      onInsert: (text) => inserted.push(text),
      onOpenLink: () => undefined,
      onSubmit: (text) => submitted.push(text),
    });

    getIconAction(element, "edit").onClick();
    getIconAction(element, "resend").onClick();

    assert.deepEqual(inserted, [rawText]);
    assert.deepEqual(submitted, [rawText]);
  });

  it("hides the assistant footer for welcome messages without a completion time", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "welcome",
              role: "assistant",
              text: "Ask Any Question.",
              status: "complete",
            },
          ],
        })}
      />,
    );

    assert.notInclude(html, "zp-message-footer");
    assert.notInclude(html, "zopilot-sidebar-copy-text");
    assert.notInclude(html, "zopilot-sidebar-insert-composer");
    assert.notInclude(html, "zopilot-sidebar-retry-turn");
  });

  it("renders completed model responses with three actions and Beijing time", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "complete",
              role: "assistant",
              text: "Done",
              status: "complete",
              completedAt: "2026-06-13 15:30",
            },
          ],
        })}
      />,
    );

    assert.include(html, "zopilot-sidebar-copy-text");
    assert.include(html, "zopilot-sidebar-insert-composer");
    assert.include(html, "zopilot-sidebar-retry-turn");
    assert.include(html, 'data-icon-name="copy"');
    assert.include(html, 'data-icon-name="insert"');
    assert.include(html, 'data-icon-name="retry"');
    assert.include(html, "2026-06-13 15:30");
  });

  it("uses only the paper title for the context chip tooltip", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          context: {
            label:
              "DeepSeekMath: Pushing the Limits of Mathematical Reasoning / 总结一下这篇论文",
            paperTitle:
              "DeepSeekMath: Pushing the Limits of Mathematical Reasoning",
            paperKey: "1:AAA",
          },
        })}
      />,
    );

    assert.include(
      html,
      'title="DeepSeekMath: Pushing the Limits of Mathematical Reasoning"',
    );
    assert.include(html, " / 总结一下这篇论文");
    assert.notInclude(
      html,
      'title="DeepSeekMath: Pushing the Limits of Mathematical Reasoning / 总结一下这篇论文"',
    );
  });

  it("sizes model and effort selectors from the selected labels", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          models: [
            {
              slug: "gpt-5.5",
              displayName: "GPT-5.5",
              supportedReasoningEfforts: ["low", "high", "xhigh"],
              defaultReasoningEffort: "medium",
            },
            {
              slug: "gpt-5.3-codex-spark",
              displayName: "GPT-5.3-Codex-Spark",
              supportedReasoningEfforts: ["low", "high", "xhigh"],
              defaultReasoningEffort: "high",
            },
          ],
          selectedModel: "gpt-5.5",
          selectedReasoningEffort: "high",
          availableReasoningEfforts: ["low", "high", "xhigh"],
        })}
      />,
    );

    assert.include(html, "inline-size:calc(7ch + 12px)");
    assert.include(html, "inline-size:calc(4ch + 12px)");
    assert.notInclude(html, 'data-icon-name="model"');
    assert.notInclude(html, 'data-icon-name="reason"');
    assert.notInclude(html, 'data-icon-name="select"');
  });

  it("shows a non-blocking Codex CLI status while checking", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          codexStatus: "checking",
        })}
      />,
    );

    assert.include(html, "zopilot-sidebar-codex-status-checking");
    assert.include(html, 'class="zp-codex-status"');
    assert.include(html, 'data-icon-name="checking"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
  });

  it("hides the Codex CLI status and shows controls after a successful connection", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          codexStatus: "connected",
        })}
      />,
    );

    assert.notInclude(html, "zopilot-sidebar-codex-status-checking");
    assert.notInclude(html, "zopilot-sidebar-codex-status-disconnected");
    assert.notInclude(html, "zp-codex-status");
    assert.include(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.include(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
  });

  it("does not render legacy CSS-drawn icon classes", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          codexStatus: "checking",
          messages: [
            {
              id: "complete",
              role: "assistant",
              text: "Done",
              status: "complete",
              completedAt: "2026-06-13 15:30",
            },
          ],
        })}
      />,
    );

    [
      "zp-action-icon",
      "zp-check-icon",
      "zp-close-icon",
      "zp-copy-icon",
      "zp-history-icon",
      "zp-plus-icon",
      "zp-send-icon",
      "zp-stop-icon",
    ].forEach((className) => assert.notInclude(html, className));
  });
});

function createState(patch: Partial<SidebarState> = {}): SidebarState {
  return {
    title: "Paper",
    context: {
      label: "Paper",
      paperKey: "1:AAA",
    },
    messages: [],
    sessions: [],
    sessionsOpen: false,
    composerEnabled: true,
    busy: false,
    models: [
      {
        slug: "gpt-5.5",
        displayName: "GPT-5.5",
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium",
      },
    ],
    selectedModel: "gpt-5.5",
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: ["medium"],
    codexStatus: "connected",
    focusToken: 0,
    ...patch,
  };
}

function createActions(): SidebarActions {
  return {
    archiveSession: () => undefined,
    close: () => undefined,
    createNewSession: () => undefined,
    hideSessions: () => undefined,
    interruptActiveTurn: () => undefined,
    openExternalLink: () => undefined,
    selectModel: () => undefined,
    selectReasoningEffort: () => undefined,
    startResize: () => undefined,
    submitPrompt: () => undefined,
    switchSession: () => undefined,
    toggleSessions: () => undefined,
  };
}

function installLocaleMock(): void {
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                messages: Array<{ id: string }>,
              ) => Array<{ value: string }>;
            };
          };
        };
      };
    }
  ).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync(messages) {
            return messages.map((message) => ({ value: message.id }));
          },
        },
      },
    },
  };
}

type IconActionProps = {
  icon: string;
  onClick: () => void;
};

function getIconAction(node: ReactNode, icon: string): IconActionProps {
  const element = findElement(node, (candidate) => {
    const props = getProps(candidate);
    return props.icon === icon && typeof props.onClick === "function";
  });

  assert.isDefined(element, `Expected ${icon} action`);
  return getProps(element) as IconActionProps;
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean,
): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (!isValidElement(node)) {
    return undefined;
  }

  if (predicate(node)) {
    return node;
  }

  return findElement(getProps(node).children as ReactNode, predicate);
}

function getProps(element: ReactElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}
