import { config } from "../../../../package.json";
import { getPref, setPref } from "../../../runtime/preferences/prefs";
import type { SidebarPromptView } from "../ui/types";
import { validatePromptInput } from "./promptSchema";

export {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  loadPromptViews,
  subscribePromptViews,
  updateCustomPrompt,
};

type StoredPrompt = {
  id: string;
  title: string;
  body: string;
  scope: "global";
  updatedAt: string;
  custom: true;
};

type PromptInput = {
  title: string;
  body: string;
};

type PromptViewListener = (prompts: SidebarPromptView[]) => void;

type PromptSyncBus = {
  listeners: PromptViewListener[];
};

const PROMPT_SYNC_BUS_KEY = "__zopilotPromptSyncBus";

function loadPromptViews(): SidebarPromptView[] {
  return loadCustomPrompts();
}

function subscribePromptViews(listener: PromptViewListener): () => void {
  const bus = getPromptSyncBus();
  bus.listeners.push(listener);
  return () => {
    const index = bus.listeners.indexOf(listener);
    if (index >= 0) {
      bus.listeners.splice(index, 1);
    }
  };
}

function createCustomPrompt(input: PromptInput): SidebarPromptView {
  const validated = validatePromptInput(input);
  const prompt: StoredPrompt = {
    id: `custom-${Date.now().toString(36)}`,
    title: validated.title,
    body: validated.body,
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
  notifyPromptViewsChanged();
}

function isStoredPrompt(value: unknown): value is StoredPrompt {
  const item = value as Partial<StoredPrompt>;
  return (
    typeof item.id === "string" &&
    item.id.startsWith("custom-") &&
    typeof item.title === "string" &&
    typeof item.body === "string" &&
    item.scope === "global" &&
    typeof item.updatedAt === "string" &&
    item.custom === true
  );
}

function notifyPromptViewsChanged(): void {
  const prompts = loadPromptViews();
  for (const listener of [...getPromptSyncBus().listeners]) {
    try {
      listener(prompts);
    } catch {
      // Keep one stale sidebar listener from blocking prompt sync elsewhere.
    }
  }
}

function getPromptSyncBus(): PromptSyncBus {
  const host = getPromptSyncHost();
  const record = host as Record<string, PromptSyncBus | undefined>;
  record[PROMPT_SYNC_BUS_KEY] ??= { listeners: [] };
  return record[PROMPT_SYNC_BUS_KEY]!;
}

function getPromptSyncHost(): object {
  const root = globalThis as typeof globalThis & {
    Zotero?: typeof Zotero & Record<string, unknown>;
    addon?: unknown;
  };
  const addonInstance = root.Zotero?.[config.addonInstance] || root.addon;
  return addonInstance && typeof addonInstance === "object"
    ? addonInstance
    : globalThis;
}
