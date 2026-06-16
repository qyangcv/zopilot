import { config } from "../../../package.json";
import {
  checkCodexConnection,
  diagnoseCodexConnection,
} from "../../codex/diagnostics";
import type { CodexDiscoverySubprocessModule } from "../../codex/cliDiscovery";

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
  getElementById(id: string): PreferencePaneStatusElement | null;
  l10n?: {
    setAttributes(element: PreferencePaneStatusElement, id: string): void;
    translateElements?(
      elements: PreferencePaneStatusElement[],
    ): Promise<unknown>;
  };
};

type PreferencePaneStatusElement = {
  dataset: Record<string, string>;
  textContent: string | null;
};

type PreferencePaneSubprocessModule = CodexDiscoverySubprocessModule;

const MAX_INIT_ATTEMPTS = 50;

function initPreferencesPane(dependencies = getGlobalDependencies()): void {
  let statusValue: PreferencePaneStatusElement | null = null;
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
    void detectCodexStatus(dependencies, statusValue);
  }
}

async function detectCodexStatus(
  dependencies: PreferencePaneDependencies,
  statusValue: PreferencePaneStatusElement,
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
  statusValue: PreferencePaneStatusElement,
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
