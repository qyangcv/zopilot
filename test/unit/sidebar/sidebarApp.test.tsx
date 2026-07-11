import { assert } from "chai";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Message,
  SidebarApp,
} from "../../../src/features/sidebar/ui/SidebarApp.tsx";
import { SessionPopover } from "../../../src/features/sidebar/ui/SessionPopover.tsx";
import type {
  SidebarActions,
  SidebarMessageView,
  SidebarPromptView,
  SidebarState,
} from "../../../src/features/sidebar/ui/types.ts";
import type { Conversation } from "../../../src/domain/conversation.ts";

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
    assert.include(html, "sidebar-trace-waiting");
    assert.notInclude(html, "zp-trace-waiting");
    assert.notInclude(html, "zp-trace-items");
  });

  it("shows live trace and collapses it when the final answer starts", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          busy: true,
          messages: [
            {
              id: "trace",
              role: "assistant",
              text: "Final answer",
              status: "complete",
              transient: true,
              running: true,
              finalStarted: true,
              trace: [
                {
                  id: "reasoning-a",
                  type: "reasoning",
                  kind: "content",
                  text: "Checking the evidence",
                },
                {
                  id: "call-a",
                  type: "tool",
                  name: "paper_read",
                  server: "zopilot",
                  arguments: '{"question":"method"}',
                  result: "Evidence",
                  status: "completed",
                  durationMs: 3_000,
                },
              ],
            },
          ],
        })}
      />,
    );

    assert.include(html, 'class="zp-trace"');
    assert.notInclude(html, 'class="zp-trace" open=""');
    assert.include(html, "sidebar-trace-collapsed");
    assert.notInclude(html, "sidebar-trace-commentary");
    assert.include(html, "Checking the evidence");
    assert.include(html, "paper_read");
    assert.include(html, "3s");
    assert.include(html, "Final answer");
  });

  it("renders every tool call separately with duration and expandable payloads", function () {
    const completedCalls = [1, 2, 3].map(
      (index): NonNullable<SidebarMessageView["trace"]>[number] => ({
        id: `call-${index}`,
        type: "tool",
        name: "paper_read",
        server: "zopilot",
        arguments: `{"question":"part ${index}"}`,
        result: `Evidence ${index}`,
        status: "completed",
        durationMs: index * 1_000,
      }),
    );
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          busy: true,
          messages: [
            {
              id: "many-tools",
              role: "assistant",
              text: "",
              running: true,
              trace: [
                ...completedCalls,
                {
                  id: "call-running",
                  type: "tool",
                  name: "paper_read",
                  server: "zopilot",
                  status: "running",
                },
                {
                  id: "call-failed",
                  type: "tool",
                  name: "paper_read",
                  server: "zopilot",
                  status: "failed",
                  error: "Failed to read",
                },
              ],
            },
          ],
        })}
      />,
    );

    assert.notInclude(html, "zp-trace-tool-group");
    assert.equal(countOccurrences(html, 'data-icon-name="tool"'), 5);
    assert.equal(countOccurrences(html, ">paper_read</code>"), 5);
    const statusIcons = html.match(
      /<svg[^>]*zp-trace-tool-status-icon[^>]*>/gu,
    );
    assert.lengthOf(statusIcons || [], 4);
    assert.lengthOf(
      (statusIcons || []).filter((icon) =>
        icon.includes('data-icon-name="check"'),
      ),
      3,
    );
    assert.lengthOf(
      (statusIcons || []).filter((icon) =>
        icon.includes('data-icon-name="close"'),
      ),
      1,
    );
    assert.include(html, "1s");
    assert.include(html, "2s");
    assert.include(html, "3s");
    assert.include(html, "sidebar-trace-tool-arguments");
    assert.include(html, "sidebar-trace-tool-result");
    assert.include(html, 'data-status="running"');
    assert.include(html, 'data-status="failed"');
    assert.notInclude(html, "zopilot · paper_read");
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

  it("renders single-paragraph user bubbles with the shared Markdown structure", function () {
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
    assert.include(html, "<p><strong>bold</strong> text</p>");
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
      onSubmit: (message) => submitted.push(message),
    });

    getIconAction(element, "edit").onClick();
    getIconAction(element, "resend").onClick();

    assert.deepEqual(
      inserted.map((message) => message.text),
      [rawText],
    );
    assert.deepEqual(
      submitted.map((message) => message.text),
      [rawText],
    );
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
    assert.include(html, "<p>Read this figure</p>");
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

  it("renders the new-chat welcome as a centered empty state", function () {
    const html = renderToStaticMarkup(
      <SidebarApp actions={createActions()} state={createState()} />,
    );

    assert.include(html, 'class="zp-chat-log" data-empty="true"');
    assert.include(html, 'class="zp-empty-welcome"');
    assert.include(html, "How should we approach this paper?");
    assert.include(html, "插入自定义 prompt");
    assert.include(html, "添加 PDF 或图片附件");
    assert.include(html, "使用 @ 在文库/合集中选择论文");
    assert.include(html, 'data-icon-name="prompt"');
    assert.include(html, 'data-icon-name="paperclip"');
    assert.notInclude(html, "zp-message-assistant");
    assert.notInclude(html, 'data-icon-name="brand"');
  });

  it("opts the composer textarea out of Zotero native input styling", function () {
    const html = renderToStaticMarkup(
      <SidebarApp actions={createActions()} state={createState()} />,
    );

    assert.include(html, 'class="zp-composer-input"');
    assert.include(html, 'no-native="true"');
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
              responseDuration: "3min 27s",
              model: "gpt-5.3-codex",
              providerBrand: "codex",
              trace: [
                {
                  id: "reasoning",
                  type: "reasoning",
                  kind: "content",
                  text: "Checked the paper",
                },
              ],
            },
          ],
        })}
      />,
    );

    assert.include(html, "zopilot-sidebar-copy-text");
    assert.include(html, 'class="zp-answer-model"');
    assert.include(html, "gpt-5.3-codex");
    assert.include(
      html,
      'class="zp-provider-brand-icon zp-message-avatar" data-provider-brand="codex"',
    );
    assert.notInclude(html, 'data-icon-name="brand"');
    assert.include(
      html,
      "chrome://zopilot/content/icons/providers/codex-color.svg",
    );
    assert.isBelow(
      html.indexOf('class="zp-answer-model"'),
      html.indexOf('class="zp-trace"'),
    );
    assert.include(html, 'data-icon-name="copy"');
    assert.include(html, 'class="zp-message-duration">3min 27s</span>');
    assert.isAbove(
      html.indexOf('class="zp-message-duration"'),
      html.indexOf('data-icon-name="copy"'),
    );
    assert.include(html, "2026-06-13 15:30");
  });

  it("renders the configured BYOK provider brand before the answer model", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "deepseek-answer",
              role: "assistant",
              text: "Done",
              status: "complete",
              model: "deepseek-v4-flash",
              providerBrand: "deepseek",
            },
          ],
        })}
      />,
    );

    assert.include(html, "deepseek-v4-flash");
    assert.include(html, 'data-provider-brand="deepseek"');
    assert.include(
      html,
      "chrome://zopilot/content/icons/providers/deepseek-color.svg",
    );
    assert.notInclude(html, 'data-icon-name="brand"');
  });

  it("falls back to the Zopilot avatar for an unknown provider", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          messages: [
            {
              id: "unknown-provider-answer",
              role: "assistant",
              text: "Done",
              status: "complete",
              model: "custom-model",
              providerBrand: "generic",
            },
          ],
        })}
      />,
    );

    assert.include(html, 'data-provider-brand="generic"');
    assert.include(html, 'data-icon-name="brand"');
    assert.include(html, "custom-model");
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
      <SessionPopover
        actions={createActions()}
        mode="archive"
        sessions={[
          {
            id: "conv-archived",
            title: "Archived question",
            meta: "Archived preview",
            active: false,
            conversation: createConversation("conv-archived"),
          },
        ]}
      />,
    );

    assert.include(html, 'aria-label="zopilot-sidebar-restore-session"');
    assert.include(html, 'class="zp-session-action zp-session-restore"');
    assert.include(html, 'data-icon-name="archiveRestore"');
    assert.include(html, "zopilot-sidebar-archived-sessions");
    assert.include(html, "Archived question");
    assert.notInclude(html, "zopilot-sidebar-delete-session");
  });

  it("uses a distinct empty state for archived sessions", function () {
    const html = renderToStaticMarkup(
      <SessionPopover actions={createActions()} mode="archive" sessions={[]} />,
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
              providerProfileId: "codex-cli.default",
              providerLabel: "Codex CLI",
              providerBrand: "codex",
              supportedReasoningEfforts: ["low", "high", "xhigh"],
              defaultReasoningEffort: "medium",
            },
            {
              slug: "gpt-5.3-codex-spark",
              displayName: "GPT-5.3-Codex-Spark",
              providerProfileId: "codex-cli.default",
              providerLabel: "Codex CLI",
              supportedReasoningEfforts: ["low", "high", "xhigh"],
              defaultReasoningEffort: "high",
            },
          ],
          selectedProviderId: "codex-cli.default",
          selectedModel: "gpt-5.5",
          selectedReasoningEffort: "high",
          availableReasoningEfforts: ["low", "high", "xhigh"],
          backendStatus: "connected",
        })}
      />,
    );

    assert.include(html, 'aria-haspopup="listbox"');
    assert.include(html, "GPT-5.5");
    assert.include(html, 'data-provider-brand="codex"');
    assert.equal(countOccurrences(html, 'data-provider-brand="codex"'), 1);
    assert.include(html, "High");
    assert.notInclude(html, "<select");
    assert.notInclude(html, "inline-size:calc(");
    assert.notInclude(html, 'data-icon-name="model"');
    assert.notInclude(html, 'data-icon-name="reason"');
    assert.notInclude(html, 'data-icon-name="select"');
  });

  it("shows a non-blocking backend status while checking", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          backendStatus: "checking",
        })}
      />,
    );

    assert.include(html, "zopilot-sidebar-backend-status-checking");
    assert.include(html, 'class="zp-backend-status"');
    assert.include(html, 'data-icon-name="checking"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
  });

  it("hides the backend status and shows controls after a successful connection", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          backendStatus: "connected",
        })}
      />,
    );

    assert.notInclude(html, "zopilot-sidebar-backend-status-checking");
    assert.notInclude(html, "zopilot-sidebar-backend-status-disconnected");
    assert.notInclude(html, "zp-backend-status");
    assert.include(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.include(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
    assert.include(html, 'aria-label="zopilot-sidebar-prompts"');
    assert.include(html, 'aria-label="zopilot-sidebar-add-context"');
    assert.include(html, 'data-icon-name="paperclip"');
  });

  it("shows a backend diagnostic without model controls after a failed connection", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          backendStatus: "disconnected",
          backendDiagnosticMessage: "Codex CLI not found",
        })}
      />,
    );

    assert.include(html, "Codex CLI not found");
    assert.notInclude(html, "zopilot-sidebar-backend-status-checking");
    assert.notInclude(html, 'aria-label="zopilot-sidebar-model-name"');
    assert.notInclude(html, 'aria-label="zopilot-sidebar-reasoning-depth"');
  });

  it("does not render legacy CSS-drawn icon classes", function () {
    const html = renderToStaticMarkup(
      <SidebarApp
        actions={createActions()}
        state={createState({
          backendStatus: "checking",
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
        providerProfileId: "codex-cli.default",
        providerLabel: "Codex CLI",
        supportedReasoningEfforts: ["medium"],
        defaultReasoningEffort: "medium",
      },
    ],
    selectedProviderId: "codex-cli.default",
    selectedModel: "gpt-5.5",
    selectedReasoningEffort: "medium",
    availableReasoningEfforts: ["medium"],
    backendStatus: "connected",
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

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
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
