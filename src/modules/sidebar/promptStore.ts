import { getPref, setPref } from "../../utils/prefs";
import { DEFAULT_PROMPTS } from "./app/commandRegistry";
import type { SidebarMode, SidebarPromptView } from "./app/types";
import { extractPromptVariables, validatePromptInput } from "./promptSchema";

export { createCustomPrompt, deleteCustomPrompt, loadPromptViews };

type StoredPrompt = {
  id: string;
  title: string;
  body: string;
  variables: string[];
  scope: "global";
  compatibleModes: SidebarMode[];
  updatedAt: string;
  custom: true;
};

type PromptInput = {
  title: string;
  body: string;
};

function loadPromptViews(): SidebarPromptView[] {
  return [...DEFAULT_PROMPTS, ...loadCustomPrompts()];
}

function createCustomPrompt(input: PromptInput): SidebarPromptView {
  const validated = validatePromptInput(input);
  const prompt: StoredPrompt = {
    id: `custom-${Date.now().toString(36)}`,
    title: validated.title,
    body: validated.body,
    variables: extractPromptVariables(validated.body),
    scope: "global",
    compatibleModes: ["ask", "agent"],
    updatedAt: new Date().toISOString(),
    custom: true,
  };
  saveCustomPrompts([...loadCustomPrompts(), prompt]);
  return prompt;
}

function deleteCustomPrompt(promptId: string): void {
  saveCustomPrompts(
    loadCustomPrompts().filter((prompt) => prompt.id !== promptId),
  );
}

function loadCustomPrompts(): StoredPrompt[] {
  const raw = getPref("prompts.custom");
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((item): StoredPrompt[] => {
      if (!isStoredPrompt(item)) {
        return [];
      }
      return [item];
    });
  } catch {
    return [];
  }
}

function saveCustomPrompts(prompts: StoredPrompt[]): void {
  setPref("prompts.custom", JSON.stringify(prompts));
}

function isStoredPrompt(value: unknown): value is StoredPrompt {
  const item = value as Partial<StoredPrompt>;
  return (
    typeof item.id === "string" &&
    item.id.startsWith("custom-") &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    Array.isArray(item.variables) &&
    item.scope === "global" &&
    Array.isArray(item.compatibleModes) &&
    item.compatibleModes.every((mode) => mode === "ask" || mode === "agent") &&
    typeof item.updatedAt === "string" &&
    item.custom === true
  );
}
