import { assert } from "chai";
import {
  buildSidebarCommands,
  filterSidebarCommands,
} from "../../../src/modules/sidebar/app/commandRegistry.ts";
import type {
  SidebarPromptView,
  SidebarState,
} from "../../../src/modules/sidebar/app/types.ts";

describe("sidebar command registry", function () {
  before(function () {
    installLocaleMock();
  });

  it("builds commands across the required product categories", function () {
    const commands = buildSidebarCommands(createState());
    const categories = new Set(commands.map((command) => command.category));

    assert.deepEqual([...categories].sort(), [
      "attachment",
      "prompt",
      "reader",
      "session",
      "source",
    ]);
  });

  it("localizes built-in command text", function () {
    const commands = buildSidebarCommands(createState());

    assert.deepInclude(commands[0], {
      id: "source.add",
      title: "添加本地附件",
      description: "为下一条消息选择 PDF 或图片路径。",
    });
    assert.deepInclude(commands[1], {
      id: "reader.evidencePrompt",
      title: "插入证据 Prompt",
      description: "插入一个要求 Codex 查找证据并返回页码或章节定位的 Prompt。",
    });
  });

  it("filters commands with Chinese aliases", function () {
    const matches = filterSidebarCommands(
      buildSidebarCommands(createState()),
      "附件",
    );

    assert.deepEqual(
      matches.map((command) => command.id),
      ["source.add", "attachment.upload"],
    );
  });

  it("makes custom prompts available when the composer is ready", function () {
    const commands = buildSidebarCommands(
      createState({
        prompts: TEST_PROMPTS,
      }),
    );

    assert.isTrue(
      commands.find((command) => command.id === "prompt.custom-critique")
        ?.available,
    );
  });

  it("disables prompt commands while the composer is unavailable", function () {
    const commands = buildSidebarCommands(
      createState({
        composerEnabled: false,
        prompts: TEST_PROMPTS,
      }),
    );

    const promptCommand = commands.find(
      (command) => command.id === "prompt.custom-critique",
    );
    assert.isFalse(promptCommand?.available);
    assert.equal(promptCommand?.disabledReason, "当前无法插入 Prompt。");
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
      workspaceKey: "item:1:AAA",
      paperKey: "1:AAA",
    },
    messages: [],
    sessions: [],
    sessionsOpen: false,
    sessionsMode: "history",
    composerEnabled: true,
    busy: false,
    models: [],
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

function installLocaleMock(): void {
  const messages = new Map([
    ["sidebar-command-source-add-title", "添加本地附件"],
    [
      "sidebar-command-source-add-description",
      "为下一条消息选择 PDF 或图片路径。",
    ],
    ["sidebar-command-source-add-disabled", "请先打开论文工作区。"],
    ["sidebar-command-reader-evidence-prompt-title", "插入证据 Prompt"],
    [
      "sidebar-command-reader-evidence-prompt-description",
      "插入一个要求 Codex 查找证据并返回页码或章节定位的 Prompt。",
    ],
    [
      "sidebar-command-reader-evidence-prompt-disabled",
      "当前无法插入证据 Prompt。",
    ],
    ["sidebar-command-attachment-upload-title", "添加附件"],
    [
      "sidebar-command-attachment-upload-description",
      "为下一条消息选择 PDF 或图片路径。",
    ],
    ["sidebar-command-attachment-upload-disabled", "请先选择工作区。"],
    ["sidebar-command-session-new-title", "新建会话"],
    ["sidebar-command-session-new-description", "在当前工作区开始新的对话。"],
    ["sidebar-command-session-history-title", "会话历史"],
    ["sidebar-command-session-history-description", "浏览之前的会话。"],
    ["sidebar-command-prompt-disabled", "当前无法插入 Prompt。"],
  ]);
  (
    globalThis as typeof globalThis & {
      addon: {
        data: {
          locale: {
            current: {
              formatMessagesSync: (
                items: Array<{ id: string }>,
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
          formatMessagesSync(items) {
            return items.map((item) => {
              const key = item.id.replace(/^zopilot-/, "");
              return { value: messages.get(key) || item.id };
            });
          },
        },
      },
    },
  };
}
