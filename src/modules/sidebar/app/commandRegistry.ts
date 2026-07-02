import type { SidebarCommandView, SidebarState } from "./types";

export { DEFAULT_PROMPTS, buildSidebarCommands, filterSidebarCommands };

const DEFAULT_PROMPTS = [
  {
    id: "prompt-summarize",
    title: "Summarize paper",
    body: "Summarize this paper with problem, method, evidence, and limitations.",
    variables: [],
    scope: "global" as const,
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
  {
    id: "prompt-critique",
    title: "Critique evidence",
    body: "Evaluate the paper's evidence quality, missing controls, and strongest counterarguments.",
    variables: [],
    scope: "global" as const,
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
];

function buildSidebarCommands(state: SidebarState): SidebarCommandView[] {
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const canUseComposer = state.composerEnabled && !state.busy;
  return [
    {
      id: "source.add",
      title: "Add local attachment",
      description: "Choose a PDF or image path for the next message.",
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
        : "Open a paper workspace first.",
    },
    {
      id: "reader.navigate",
      title: "Navigate reader evidence",
      description: "Jump to evidence locators when a response provides them.",
      keywords: ["reader", "page", "evidence", "定位", "跳转"],
      category: "reader",
      icon: "reader",
      available: hasWorkspace,
      disabledReason: hasWorkspace ? undefined : "Open a PDF reader first.",
    },
    {
      id: "attachment.upload",
      title: "Add attachment",
      description: "Choose a PDF or image path for the next message.",
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
      disabledReason: hasWorkspace ? undefined : "Select a workspace first.",
    },
    {
      id: "session.new",
      title: "New chat",
      description: "Start a new conversation in this workspace.",
      keywords: ["session", "new", "chat", "新建", "会话"],
      category: "session",
      icon: "newChat",
      available: hasWorkspace && !state.busy,
    },
    {
      id: "session.history",
      title: "Conversation history",
      description: "Browse previous conversations.",
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
        : "Composer is not ready for prompt insertion.",
    })),
    ...state.skills.map((skill) => ({
      id: `skill.${skill.id}`,
      title: skill.title,
      description: `${skill.description} · ${skill.status}`,
      keywords: [
        "skill",
        skill.title,
        skill.description,
        skill.category,
        "技能",
      ],
      category: "skill" as const,
      icon: "skill",
      available: skill.enabled && skill.status === "available",
      disabledReason: resolveSkillDisabledReason(skill),
    })),
  ];
}

function resolveSkillDisabledReason(
  skill: SidebarState["skills"][number],
): string | undefined {
  if (!skill.enabled) {
    return "Skill is disabled.";
  }
  if (skill.status === "requires-context") {
    return "Skill requires more Zotero context.";
  }
  return undefined;
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
