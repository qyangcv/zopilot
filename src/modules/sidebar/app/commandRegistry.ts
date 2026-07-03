import { getString } from "../../../utils/locale";
import type { SidebarCommandView, SidebarState } from "./types";

export { buildSidebarCommands, filterSidebarCommands };

function buildSidebarCommands(state: SidebarState): SidebarCommandView[] {
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const canUseComposer = state.composerEnabled && !state.busy;
  return [
    {
      id: "source.add",
      title: getString("sidebar-command-source-add-title"),
      description: getString("sidebar-command-source-add-description"),
      keywords: [
        "source",
        "context",
        "paper",
        "attachment",
        "file",
        "上下文",
        "文件",
      ],
      category: "source",
      icon: "context",
      available: hasWorkspace && !state.busy,
      disabledReason: hasWorkspace
        ? undefined
        : getString("sidebar-command-source-add-disabled"),
    },
    {
      id: "reader.navigate",
      title: getString("sidebar-command-reader-navigate-title"),
      description: getString("sidebar-command-reader-navigate-description"),
      keywords: ["reader", "page", "evidence", "定位", "跳转"],
      category: "reader",
      icon: "reader",
      available: hasWorkspace,
      disabledReason: hasWorkspace
        ? undefined
        : getString("sidebar-command-reader-navigate-disabled"),
    },
    {
      id: "attachment.upload",
      title: getString("sidebar-command-attachment-upload-title"),
      description: getString("sidebar-command-attachment-upload-description"),
      keywords: [
        "attachment",
        "upload",
        "pdf",
        "image",
        "附件",
        "上传",
        "图片",
      ],
      category: "attachment",
      icon: "attachment",
      available: hasWorkspace && !state.busy,
      disabledReason: hasWorkspace
        ? undefined
        : getString("sidebar-command-attachment-upload-disabled"),
    },
    {
      id: "session.new",
      title: getString("sidebar-command-session-new-title"),
      description: getString("sidebar-command-session-new-description"),
      keywords: ["session", "new", "chat", "新建", "会话"],
      category: "session",
      icon: "newChat",
      available: hasWorkspace && !state.busy,
    },
    {
      id: "session.history",
      title: getString("sidebar-command-session-history-title"),
      description: getString("sidebar-command-session-history-description"),
      keywords: ["history", "session", "archive", "历史", "会话"],
      category: "session",
      icon: "history",
      available: hasWorkspace,
    },
    ...state.prompts.map((prompt) => ({
      id: `prompt.${prompt.id}`,
      title: prompt.title,
      description: prompt.body,
      keywords: ["prompt", prompt.title, ...prompt.variables, "提示词"],
      category: "prompt" as const,
      icon: "prompt",
      available: canUseComposer,
      disabledReason: canUseComposer
        ? undefined
        : getString("sidebar-command-prompt-disabled"),
    })),
  ];
}

function filterSidebarCommands(
  commands: SidebarCommandView[],
  query: string,
): SidebarCommandView[] {
  const normalized = normalize(query);
  if (!normalized) {
    return commands;
  }
  return commands.filter((command) => {
    const haystack = normalize(
      [
        command.title,
        command.description,
        command.category,
        ...command.keywords,
      ].join(" "),
    );
    return fuzzyIncludes(haystack, normalized);
  });
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
  if (haystack.includes(needle)) {
    return true;
  }
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor < 0) {
      return false;
    }
    cursor++;
  }
  return true;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}
