import { getPref, setPref } from "../../utils/prefs";
import type { SidebarMode, SidebarSkillView } from "./app/types";

export {
  DEFAULT_SKILL_DEFINITIONS,
  DEFAULT_SKILLS,
  createSkillViews,
  loadSkillViews,
  setSkillEnabled,
};

type SkillDefinition = {
  id: string;
  title: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  requiredContext: Array<"workspace" | "reader">;
  compatibleModes: SidebarMode[];
};

const DEFAULT_SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: "skill-literature-map",
    title: "Literature map",
    description: "Organize related sources into a comparison map.",
    category: "research",
    defaultEnabled: false,
    requiredContext: ["workspace"],
    compatibleModes: ["agent"],
  },
  {
    id: "skill-method-check",
    title: "Method check",
    description: "Check methodology, evidence, and missing controls.",
    category: "review",
    defaultEnabled: true,
    requiredContext: ["reader"],
    compatibleModes: ["ask", "agent"],
  },
];

const DEFAULT_SKILLS = createSkillViews(
  {},
  {
    hasReader: false,
    hasWorkspace: false,
  },
);

function createSkillViews(
  enabled: Record<string, boolean>,
  input: { hasReader: boolean; hasWorkspace: boolean },
): SidebarSkillView[] {
  return DEFAULT_SKILL_DEFINITIONS.map((definition) => {
    const skillEnabled = enabled[definition.id] ?? definition.defaultEnabled;
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      enabled: skillEnabled,
      status: resolveSkillStatus(definition, skillEnabled, input),
      requiredContext: definition.requiredContext,
      compatibleModes: definition.compatibleModes,
    };
  });
}

function loadSkillViews(input: {
  hasReader: boolean;
  hasWorkspace: boolean;
}): SidebarSkillView[] {
  return createSkillViews(loadSkillEnabledMap(), input);
}

function setSkillEnabled(skillId: string, enabled: boolean): void {
  const current = loadSkillEnabledMap();
  current[skillId] = enabled;
  setPref("skills.enabled", JSON.stringify(current));
}

function resolveSkillStatus(
  definition: SkillDefinition,
  enabled: boolean,
  input: { hasReader: boolean; hasWorkspace: boolean },
): SidebarSkillView["status"] {
  if (!enabled) {
    return "disabled";
  }
  if (
    (definition.requiredContext.includes("reader") && !input.hasReader) ||
    (definition.requiredContext.includes("workspace") && !input.hasWorkspace)
  ) {
    return "requires-context";
  }
  return "available";
}

function loadSkillEnabledMap(): Record<string, boolean> {
  const raw = getPref("skills.enabled");
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "boolean" ? [[key, value]] : [],
      ),
    );
  } catch {
    return {};
  }
}
