import type { SidebarCommandView, SidebarMode, SidebarState } from "./types";

export { DEFAULT_PROMPTS, buildSidebarCommands, filterSidebarCommands };

const DEFAULT_PROMPTS = [
  {
    id: "prompt-summarize",
    title: "Summarize paper",
    body: "Summarize this paper with problem, method, evidence, and limitations.",
    variables: [],
    scope: "global" as const,
    compatibleModes: ["ask", "agent"] satisfies SidebarMode[],
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
  {
    id: "prompt-critique",
    title: "Critique evidence",
    body: "Evaluate the paper's evidence quality, missing controls, and strongest counterarguments.",
    variables: [],
    scope: "global" as const,
    compatibleModes: ["ask"] satisfies SidebarMode[],
    updatedAt: "2026-07-02T00:00:00.000Z",
  },
];

function buildSidebarCommands(state: SidebarState): SidebarCommandView[] {
  const hasWorkspace = Boolean(state.context.workspaceKey);
  const canUseComposer = state.composerEnabled && !state.busy;
  return [
    {
      id: "mode.ask",
      title: "Ask mode",
      description: "Answer from the current reading context.",
      keywords: ["ask", "qa", "read", "问答", "阅读"],
      category: "mode",
      icon: "askMode",
      available: state.selectedMode !== "ask",
    },
    {
      id: "mode.agent",
      title: "Agent mode",
      description: "Let Codex plan actions and use available tools.",
      keywords: ["agent", "tools", "plan", "代理", "工具"],
      category: "mode",
      icon: "agentMode",
      available: state.selectedMode !== "agent",
    },
    {
      id: "source.add",
      title: "Add source context",
      description: "Open the source context picker.",
      keywords: ["source", "context", "paper", "上下文", "来源"],
      category: "source",
      icon: "context",
      available: hasWorkspace,
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
      title: "Attach PDF",
      description: "Import or link a PDF through Zotero attachment APIs.",
      keywords: ["attachment", "upload", "pdf", "附件", "上传"],
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
      available:
        canUseComposer && prompt.compatibleModes.includes(state.selectedMode),
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
      available:
        skill.enabled &&
        skill.status === "available" &&
        skill.compatibleModes.includes(state.selectedMode),
      disabledReason: resolveSkillDisabledReason(skill, state.selectedMode),
    })),
  ];
}

function resolveSkillDisabledReason(
  skill: SidebarState["skills"][number],
  mode: SidebarMode,
): string | undefined {
  if (!skill.enabled) {
    return "Skill is disabled.";
  }
  if (skill.status === "requires-context") {
    return "Skill requires more Zotero context.";
  }
  if (!skill.compatibleModes.includes(mode)) {
    return "Skill is not compatible with this mode.";
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
