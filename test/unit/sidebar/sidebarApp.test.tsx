import { assert } from "chai";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarApp } from "../../../src/modules/sidebar/app/SidebarApp.tsx";
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
    assert.include(html, 'class="zp-stop-icon"');
    assert.notInclude(html, "zp-message-footer");
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
    assert.include(html, "2026-06-13 15:30");
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

    assert.include(html, "inline-size:9ch");
    assert.include(html, "inline-size:6ch");
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
