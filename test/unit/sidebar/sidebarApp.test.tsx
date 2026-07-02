import { assert } from "chai";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Message,
  SidebarApp,
} from "../../../src/modules/sidebar/app/SidebarApp.tsx";
import type {
  SidebarActions,
  SidebarMessageView,
  SidebarPromptView,
  SidebarState,
} from "../../../src/modules/sidebar/app/types.ts";
import type { Conversation } from "../../../src/shared/conversation.ts";

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

  it("keeps edit and resend actions bound to raw user text and context", function () {
    const rawText = "**raw** [link](https://example.com)";
    const mention = {
      id: "mention-paper",
      sourceId: "source-paper",
      paperKey: "1:AAA",
      libraryID: 1,
      parentItemID: 10,
      parentItemKey: "AAA",
      attachmentItemID: 11,
      attachmentKey: "PDF",
      title: "CodeV",
    };
    const attachment = {
      id: "local-figure",
      path: "/tmp/figure.png",
      filename: "figure.png",
      kind: "image" as const,
      mimeType: "image/png",
    };
    const inserted: SidebarMessageView[] = [];
    const submitted: SidebarMessageView[] = [];
    const element = Message({
      busy: false,
      copiedId: null,
      message: {
        id: "raw-user",
        role: "user",
        text: rawText,
        mentions: [mention],
        localAttachments: [attachment],
      },
      onCopy: () => undefined,
      onEdit: (message) => inserted.push(message),
      onOpenLink: () => undefined,
      onOpenLocator: () => undefined,
      onSubmit: (message) => submitted.push(message),
    });

    getIconAction(element, "edit").onClick();
    getIconAction(element, "resend").onClick();

    assert.deepEqual(inserted.map((message) => message.text), [rawText]);
    assert.deepEqual(submitted.map((message) => message.text), [rawText]);
    assert.deepEqual(inserted[0]?.mentions, [mention]);
    assert.deepEqual(submitted[0]?.mentions, [mention]);
    assert.deepEqual(inserted[0]?.localAttachments, [attachment]);
    assert.deepEqual(submitted[0]?.localAttachments, [attachment]);
  });

  it("renders sent user message attachments inside the message bubble", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "user-with-attachment",
              role: "user",
              text: "Read this figure",
              localAttachments: [
                {
                  id: "local-figure",
                  path: "/tmp/figure.png",
                  filename: "figure.png",
                  kind: "image",
                  mimeType: "image/png",
                },
              ],
            },
          ],
        })}
      />,
    );

    assert.include(html, 'class="zp-message-bubble zp-message-user-content"');
    assert.include(
      html,
      'class="zp-context-chips zp-local-attachments zp-message-attachments"',
    );
    assert.include(html, 'data-icon-name="attachmentImage"');
    assert.include(html, "figure.png");
    assert.notInclude(html, "zopilot-sidebar-attachment-remove");
  });

  it("renders sent @ papers and PDF attachments as distinct context chips", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "user-with-context",
              role: "user",
              text: "Compare these sources",
              mentions: [
                {
                  id: "mention-paper",
                  sourceId: "source-paper",
                  paperKey: "1:AAA",
                  libraryID: 1,
                  parentItemID: 10,
                  parentItemKey: "AAA",
                  attachmentItemID: 11,
                  attachmentKey: "PDF",
                  title: "CodeV: Code with Images",
                },
              ],
              localAttachments: [
                {
                  id: "local-paper",
                  path: "/tmp/paper.pdf",
                  filename: "paper.pdf",
                  kind: "pdf",
                  mimeType: "application/pdf",
                },
              ],
            },
          ],
        })}
      />,
    );

    assert.include(html, "CodeV: Code with Images");
    assert.include(html, "paper.pdf");
    assert.include(html, 'data-icon-name="paperMention"');
    assert.include(html, 'data-icon-name="attachmentPdf"');
    assert.include(html, "zp-context-chip");
    assert.notInclude(html, "@CodeV: Code with Images");
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
  });

  it("renders completed model responses with copy action and Beijing time", function () {
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
    assert.include(html, 'data-icon-name="copy"');
    assert.include(html, "2026-06-13 15:30");
  });

  it("does not render the paper context chip above the composer", function () {
    const paperTitle =
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning";
    const sessionTitle = `${paperTitle} / 总结一下这篇论文`;
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          title: sessionTitle,
          context: {
            label: paperTitle,
            workspaceKey: "item:1:AAA",
            workspaceType: "item",
            paperTitle,
            paperKey: "1:AAA",
          },
        })}
      />,
    );

    assert.include(
      html,
      'title="DeepSeekMath: Pushing the Limits of Mathematical Reasoning / 总结一下这篇论文"',
    );
    assert.notInclude(html, "zp-context-row");
    assert.notInclude(html, "zp-context-chip");
    assert.notInclude(html, "zp-context-chip-text");
    assert.notInclude(html, "zopilot-sidebar-context-details");
    assert.notInclude(html, "zopilot-sidebar-current-context");
  });

  it("renders the workspace selector in the bottom status row", function () {
    const paperTitle =
      "DeepSeekMath: Pushing the Limits of Mathematical Reasoning";
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          context: {
            label: paperTitle,
            workspaceKey: "item:1:AAA",
            workspaceType: "item",
            paperTitle,
            paperKey: "1:AAA",
          },
        })}
      />,
    );

    assert.include(html, 'class="zp-workspace-status-row"');
    assert.include(html, "zp-workspace-trigger");
    assert.include(html, 'aria-label="zopilot-sidebar-workspace-current"');
    assert.include(html, 'data-icon-name="workspace"');
    assert.include(
      html,
      '<span class="zp-workspace-trigger-label">zopilot-sidebar-chat-workspace</span>',
    );
    assert.include(
      html,
      `<span class="zp-workspace-trigger-text">${paperTitle}</span>`,
    );
    assert.include(
      html,
      '<span class="zp-workspace-type-badge">zopilot-sidebar-workspace-item</span>',
    );
    assert.notInclude(html, "zp-context-row");
    assert.notInclude(html, "zp-context-chip");
    assert.notInclude(
      html,
      '<span class="zp-workspace-trigger-text">zopilot-sidebar-workspace-item</span>',
    );
  });

  it("renders the archived session entry and archive popover mode", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          sessionsOpen: true,
          sessionsMode: "archive",
          sessions: [
            {
              id: "conv-archived",
              title: "Archived question",
              meta: "Archived preview",
              active: false,
              conversation: createConversation("conv-archived"),
            },
          ],
        })}
      />,
    );

    assert.include(html, 'aria-label="zopilot-sidebar-archived-sessions"');
    assert.include(html, 'aria-label="zopilot-sidebar-restore-session"');
    assert.include(html, 'class="zp-session-action zp-session-restore"');
    assert.include(html, 'data-icon-name="archiveRestore"');
    assert.include(html, "zopilot-sidebar-archived-sessions");
    assert.include(html, "Archived question");
    assert.notInclude(html, "zopilot-sidebar-delete-session");
  });

  it("uses a distinct empty state for archived sessions", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          sessionsOpen: true,
          sessionsMode: "archive",
          sessions: [],
        })}
      />,
    );

    assert.include(html, "zopilot-sidebar-no-archived-sessions");
    assert.notInclude(html, "zopilot-sidebar-no-sessions");
  });

  it("renders model and effort selectors without native select sizing", function () {
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

    assert.include(html, 'aria-haspopup="listbox"');
    assert.include(html, "GPT-5.5");
    assert.include(html, "High");
    assert.notInclude(html, "<select");
    assert.notInclude(html, "inline-size:calc(");
    assert.notInclude(html, 'data-icon-name="model"');
    assert.notInclude(html, 'data-icon-name="reason"');
    assert.notInclude(html, 'data-icon-name="select"');
    assert.notInclude(html, "zp-ui-select-icon");
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
    assert.include(html, 'aria-label="zopilot-sidebar-command-menu"');
    assert.include(html, 'aria-label="zopilot-sidebar-prompts"');
    assert.include(html, 'aria-label="zopilot-sidebar-add-context"');
  });

  it("shows a Codex diagnostic without model controls after a failed connection", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          codexStatus: "disconnected",
          codexDiagnostic: "cli_not_found",
        })}
      />,
    );

    assert.include(html, "zopilot-codex-diagnostic-cli-not-found");
    assert.notInclude(html, "zopilot-sidebar-codex-status-checking");
    assert.notInclude(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
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

const TEST_PROMPTS: SidebarPromptView[] = [
  {
    id: "custom-critique",
    title: "Critique paper",
    body: "Critique {{paper}}.",
    variables: ["paper"],
    scope: "global",
    updatedAt: "2026-06-13T07:00:00.000Z",
    custom: true,
  },
];

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
    sessionsMode: "history",
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
    sourceCandidates: [],
    collectionOptions: [],
    prompts: TEST_PROMPTS,
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
    openReaderLocator: () => undefined,
    selectModel: () => undefined,
    selectReasoningEffort: () => undefined,
    selectWorkspaceMode: () => undefined,
    selectCollectionWorkspace: () => undefined,
    selectItemWorkspace: () => undefined,
    submitPrompt: () => undefined,
    uploadAttachment: async () => undefined,
    restoreSession: () => undefined,
    switchSession: () => undefined,
    toggleArchivedSessions: () => undefined,
    toggleSessions: () => undefined,
  };
}

function createConversation(id: string): Conversation {
  return {
    metadata: {
      id,
      scope: "paper",
      paperKey: "1:AAA",
      libraryID: 1,
      parentItemKey: "AAA",
      attachmentItemID: 10,
      attachmentKey: "PDF",
      title: "Paper",
      label: "Archived question",
      createdAt: "2026-06-13T07:00:00.000Z",
      updatedAt: "2026-06-13T07:31:00.000Z",
      archived: true,
    },
    messages: [],
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
