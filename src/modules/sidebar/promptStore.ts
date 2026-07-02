import { getPref, setPref } from "../../utils/prefs";
import type { SidebarPromptView } from "./app/types";
import { extractPromptVariables, validatePromptInput } from "./promptSchema";

export {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  loadPromptViews,
  updateCustomPrompt,
};

type StoredPrompt = {
  id: string;
  title: string;
  body: string;
  variables: string[];
  scope: "global";
  updatedAt: string;
  custom: true;
};

type PromptInput = {
  title: string;
  body: string;
};

function loadPromptViews(): SidebarPromptView[] {
  return loadCustomPrompts();
}

function createCustomPrompt(input: PromptInput): SidebarPromptView {
  const validated = validatePromptInput(input);
  const prompt: StoredPrompt = {
    id: `custom-${Date.now().toString(36)}`,
    title: validated.title,
    body: validated.body,
    variables: extractPromptVariables(validated.body),
    scope: "global",
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

function updateCustomPrompt(
  promptId: string,
  input: PromptInput,
): SidebarPromptView {
  const validated = validatePromptInput(input);
  const prompts = loadCustomPrompts();
  const promptIndex = prompts.findIndex((prompt) => prompt.id === promptId);
  if (promptIndex < 0) {
    throw new Error("Prompt not found.");
  }
  const updated: StoredPrompt = {
    ...prompts[promptIndex],
    title: validated.title,
    body: validated.body,
    variables: extractPromptVariables(validated.body),
    updatedAt: new Date().toISOString(),
  };
  saveCustomPrompts([
    ...prompts.slice(0, promptIndex),
    updated,
    ...prompts.slice(promptIndex + 1),
  ]);
  return updated;
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
      return [
        {
          id: item.id,
          title: item.title,
          body: item.body,
          variables: item.variables,
          scope: item.scope,
          updatedAt: item.updatedAt,
          custom: item.custom,
        },
      ];
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
    typeof item.updatedAt === "string" &&
    item.custom === true
  );
}
