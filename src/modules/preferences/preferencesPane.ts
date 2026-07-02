import { config } from "../../../package.json";
import {
  checkCodexConnection,
  diagnoseCodexConnection,
} from "../../codex/diagnostics";
import type { CodexDiscoverySubprocessModule } from "../../codex/cliDiscovery";
import {
  createCustomPrompt,
  deleteCustomPrompt,
  loadCustomPrompts,
  updateCustomPrompt,
} from "../sidebar/promptStore";

export { initPreferencesPane };

declare const document: PreferencePaneDocument | undefined;

type PreferencePaneDependencies = {
  document: PreferencePaneDocument;
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  getSubprocess(): PreferencePaneSubprocessModule;
};

type PreferencePaneDocument = {
  createElement(tagName: string): PreferencePaneElement;
  getElementById(id: string): PreferencePaneElement | null;
  l10n?: {
    setAttributes(element: PreferencePaneElement, id: string): void;
    translateElements?(elements: PreferencePaneElement[]): Promise<unknown>;
  };
};

type PreferencePaneElement = {
  addEventListener?(
    type: string,
    listener: (event: PreferencePaneEvent) => void,
  ): void;
  append?(...nodes: PreferencePaneElement[]): void;
  className?: string;
  dataset: Record<string, string>;
  disabled?: boolean;
  replaceChildren?(...nodes: PreferencePaneElement[]): void;
  setAttribute?(name: string, value: string): void;
  title?: string;
  textContent: string | null;
  value?: string;
};

type PreferencePaneEvent = {
  preventDefault(): void;
};

type PreferencePaneSubprocessModule = CodexDiscoverySubprocessModule;
type PromptView = ReturnType<typeof loadCustomPrompts>[number];

const MAX_INIT_ATTEMPTS = 50;

function initPreferencesPane(dependencies = getGlobalDependencies()): void {
  let statusValue: PreferencePaneElement | null = null;
  let initAttempts = 0;
  let initialized = false;

  scheduleInit();

  function scheduleInit(): void {
    dependencies.schedule(initWhenReady, 0);
  }

  function initWhenReady(): void {
    if (initialized) {
      return;
    }

    statusValue = dependencies.document.getElementById(
      "zopilot-codex-status-value",
    );
    if (!statusValue) {
      initAttempts += 1;
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        scheduleInit();
      }
      return;
    }

    initialized = true;
    setStatus(statusValue, dependencies.document, "missing");
    initPromptPreferences(dependencies.document);
    void detectCodexStatus(dependencies, statusValue);
  }
}

async function detectCodexStatus(
  dependencies: PreferencePaneDependencies,
  statusValue: PreferencePaneElement,
): Promise<void> {
  let subprocess: PreferencePaneSubprocessModule | undefined;
  try {
    subprocess = dependencies.getSubprocess();
    if (await checkCodexConnection(subprocess)) {
      setStatus(statusValue, dependencies.document, "connected");
      return;
    }
  } catch {
    // Failure details are intentionally resolved by the shared diagnostics.
  }
  const diagnostic = subprocess
    ? await diagnoseCodexConnection(subprocess).catch(() => undefined)
    : undefined;
  setStatus(
    statusValue,
    dependencies.document,
    "missing",
    diagnostic?.messageKey || "codex-diagnostic-unknown-error",
  );
}

function setStatus(
  statusValue: PreferencePaneElement,
  document: PreferencePaneDocument,
  status: "connected" | "missing",
  messageKey?: string,
): void {
  const l10nId =
    messageKey ||
    (status === "connected"
      ? "pref-codex-status-connected"
      : "pref-codex-status-missing");
  statusValue.dataset.status = status;
  statusValue.textContent = "";
  if (document.l10n?.setAttributes) {
    document.l10n.setAttributes(statusValue, `${config.addonRef}-${l10nId}`);
    void document.l10n
      ?.translateElements?.([statusValue])
      ?.catch(() => undefined);
  }
}

function initPromptPreferences(document: PreferencePaneDocument): void {
  const list = document.getElementById("zopilot-prompt-list");
  const form = document.getElementById("zopilot-prompt-form");
  const titleInput = document.getElementById("zopilot-prompt-title");
  const bodyInput = document.getElementById("zopilot-prompt-body");
  const error = document.getElementById("zopilot-prompt-error");
  const newButton = document.getElementById("zopilot-prompt-new");
  const deleteButton = document.getElementById("zopilot-prompt-delete");
  if (
    !list ||
    !form?.addEventListener ||
    !titleInput ||
    !bodyInput ||
    !error ||
    !newButton?.addEventListener ||
    !deleteButton?.addEventListener
  ) {
    return;
  }

  let selectedPromptId: string | undefined;
  let prompts = loadCustomPrompts();

  const clearError = () => {
    error.textContent = "";
  };
  const setError = (message: string) => {
    error.textContent = message;
  };
  const loadEditor = (prompt?: PromptView) => {
    selectedPromptId = prompt?.id;
    titleInput.value = prompt?.title || "";
    bodyInput.value = prompt?.body || "";
    deleteButton.disabled = !prompt;
    clearError();
    renderList();
  };
  const selectPrompt = (promptId: string) => {
    loadEditor(prompts.find((prompt) => prompt.id === promptId));
  };
  const renderList = () => {
    if (!list.replaceChildren) {
      return;
    }
    if (!prompts.length) {
      const empty = document.createElement("div");
      empty.className = "zopilot-prompt-empty";
      setLocalizedText(document, empty, "pref-prompt-empty");
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(
      ...prompts.map((prompt) => {
        const row = document.createElement("button");
        row.className = "zopilot-prompt-row";
        row.dataset.selected = String(prompt.id === selectedPromptId);
        row.setAttribute?.("type", "button");
        row.setAttribute?.("role", "option");
        row.title = prompt.body;
        row.addEventListener?.("click", () => selectPrompt(prompt.id));

        const title = document.createElement("span");
        title.className = "zopilot-prompt-row-title";
        title.textContent = prompt.title;
        const body = document.createElement("span");
        body.className = "zopilot-prompt-row-body";
        body.textContent = prompt.body;
        row.append?.(title, body);
        return row;
      }),
    );
  };
  const refreshPrompts = (nextSelectedId?: string) => {
    prompts = loadCustomPrompts();
    const nextSelected = nextSelectedId
      ? prompts.find((prompt) => prompt.id === nextSelectedId)
      : prompts.find((prompt) => prompt.id === selectedPromptId);
    loadEditor(nextSelected);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const input = {
        title: titleInput.value || "",
        body: bodyInput.value || "",
      };
      const saved = selectedPromptId
        ? updateCustomPrompt(selectedPromptId, input)
        : createCustomPrompt(input);
      refreshPrompts(saved.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    }
  });
  newButton.addEventListener("click", () => loadEditor());
  deleteButton.addEventListener("click", () => {
    if (!selectedPromptId) {
      return;
    }
    deleteCustomPrompt(selectedPromptId);
    refreshPrompts();
  });

  loadEditor(prompts[0]);
}

function setLocalizedText(
  document: PreferencePaneDocument,
  element: PreferencePaneElement,
  messageKey: string,
): void {
  element.textContent = "";
  if (!document.l10n?.setAttributes) {
    element.textContent = messageKey;
    return;
  }
  document.l10n.setAttributes(element, `${config.addonRef}-${messageKey}`);
  void document.l10n.translateElements?.([element])?.catch(() => undefined);
}

function getGlobalDependencies(): PreferencePaneDependencies {
  if (!document) {
    throw new Error("Preference pane document is unavailable.");
  }
  return {
    document,
    schedule(callback, delayMs) {
      return setTimeout(callback, delayMs);
    },
    getSubprocess() {
      return ChromeUtils.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      ).Subprocess;
    },
  };
}

if (typeof document !== "undefined") {
  initPreferencesPane();
}
