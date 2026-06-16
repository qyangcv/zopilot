import { config } from "../../../package.json";
import {
  buildCodexSubprocessEnvironment,
  type CodexDiscoverySubprocessProcess,
  resolveCodexBinaryPath,
  type CodexDiscoverySubprocessModule,
} from "../../codex/cliDiscovery";

export { initPreferencesPane };

declare const document: PreferencePaneDocument | undefined;

type PreferencePaneDependencies = {
  document: PreferencePaneDocument;
  schedule(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  cancelTimer(timer: ReturnType<typeof setTimeout>): void;
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

const COMMAND_TIMEOUT_MS = 5000;
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
  try {
    const subprocess = dependencies.getSubprocess();
    const environment = await buildCodexSubprocessEnvironment(subprocess);
    const command = await resolveCodexBinaryPath(environment.PATH);

    const appServer = await runCommand(
      dependencies,
      subprocess,
      command,
      ["app-server", "--help"],
      environment,
    );
    if (appServer.exitCode !== 0) {
      setStatus(statusValue, dependencies.document, "missing");
      return;
    }

    const loggedIn = await readCodexLoginStatus(
      dependencies,
      subprocess,
      command,
      environment,
    );
    setStatus(
      statusValue,
      dependencies.document,
      loggedIn ? "connected" : "missing",
    );
  } catch {
    setStatus(statusValue, dependencies.document, "missing");
  }
}

async function readCodexLoginStatus(
  dependencies: PreferencePaneDependencies,
  subprocess: PreferencePaneSubprocessModule,
  command: string,
  environment: Record<string, string>,
): Promise<boolean> {
  const result = await runCommand(
    dependencies,
    subprocess,
    command,
    ["login", "status"],
    environment,
  );
  const output = `${result.stdout}\n${result.stderr}`;
  const authenticated = /logged in|authenticated/i.test(output);
  const unauthenticated =
    /not logged in|not authenticated|not signed in|unauthenticated/i.test(
      output,
    );
  return result.exitCode === 0 && authenticated && !unauthenticated;
}

async function runCommand(
  dependencies: PreferencePaneDependencies,
  subprocess: PreferencePaneSubprocessModule,
  command: string,
  args: string[],
  environment: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = await subprocess.call({
    command,
    arguments: args,
    environment,
    environmentAppend: true,
    stdout: "pipe",
    stderr: "pipe",
    workdir: subprocess.getEnvironment().HOME,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    timer = dependencies.schedule(
      () =>
        void proc.kill(500).then(
          () => resolve({ exitCode: 124, stdout: "", stderr: "" }),
          () => resolve({ exitCode: 124, stdout: "", stderr: "" }),
        ),
      COMMAND_TIMEOUT_MS,
    );
  });

  const completed = Promise.all([
    proc.wait(),
    readStream(proc.stdout),
    proc.stderr ? readStream(proc.stderr) : Promise.resolve(""),
  ]).then(([waitResult, stdout, stderr]) => ({
    exitCode: waitResult.exitCode,
    stdout,
    stderr,
  }));

  const result = await Promise.race([completed, timeout]);
  if (timer) {
    dependencies.cancelTimer(timer);
  }
  return result;
}

async function readStream(
  stream: CodexDiscoverySubprocessProcess["stdout"],
): Promise<string> {
  let output = "";
  while (true) {
    const chunk = await stream.readString().catch(() => "");
    if (!chunk) {
      return output;
    }
    output += chunk;
  }
}

function setStatus(
  statusValue: PreferencePaneStatusElement,
  document: PreferencePaneDocument,
  status: "connected" | "missing",
): void {
  const l10nId =
    status === "connected"
      ? "pref-codex-status-connected"
      : "pref-codex-status-missing";
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
    cancelTimer(timer) {
      clearTimeout(timer);
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
