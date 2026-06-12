/* global ChromeUtils, IOUtils, clearTimeout, document, setTimeout */

(() => {
  const L10N_PREFIX = "__addonRef__";
  const COMMAND_TIMEOUT_MS = 5000;
  const MAX_INIT_ATTEMPTS = 20;

  let statusValue;
  let initAttempts = 0;

  init();

  function init() {
    statusValue = document.getElementById("zotero-copilot-codex-status-value");

    if (!statusValue) {
      initAttempts += 1;
      if (initAttempts <= MAX_INIT_ATTEMPTS) {
        setTimeout(init, 50);
      }
      return;
    }

    setStatus("missing", "pref-codex-status-missing");
    void detectCodexStatus();
  }

  async function detectCodexStatus() {
    try {
      const subprocess = getSubprocess();
      const command = await resolveCodexBinaryPath();

      const appServer = await runCommand(subprocess, command, [
        "app-server",
        "--help",
      ]);
      if (appServer.exitCode !== 0) {
        setStatus("missing", "pref-codex-status-missing");
        return;
      }

      const login = await readCodexLoginStatus(subprocess, command);
      setStatus(
        login.loggedIn ? "connected" : "missing",
        login.loggedIn
          ? "pref-codex-status-connected"
          : "pref-codex-status-missing",
      );
    } catch {
      setStatus("missing", "pref-codex-status-missing");
    }
  }

  async function readCodexLoginStatus(subprocess, command) {
    const result = await runCommand(subprocess, command, ["login", "status"]);
    const output = `${result.stdout}\n${result.stderr}`;
    const authenticated = /logged in|authenticated/i.test(output);
    const unauthenticated =
      /not logged in|not authenticated|not signed in|unauthenticated/i.test(
        output,
      );
    return {
      loggedIn: result.exitCode === 0 && authenticated && !unauthenticated,
    };
  }

  async function runCommand(subprocess, command, args) {
    const proc = await subprocess.call({
      command,
      arguments: args,
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
      workdir: getUserHomeDirectory(subprocess.getEnvironment()),
    });

    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(async () => {
        await proc.kill(500).catch(() => undefined);
        resolve({ exitCode: 124, stdout: "", stderr: "" });
      }, COMMAND_TIMEOUT_MS);
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
    clearTimeout(timer);
    return result;
  }

  async function readStream(stream) {
    let output = "";
    while (true) {
      const chunk = await stream.readString().catch(() => "");
      if (!chunk) {
        return output;
      }
      output += chunk;
    }
  }

  async function resolveCodexBinaryPath() {
    const candidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
    for (const candidate of candidates) {
      if (await IOUtils.exists(candidate)) {
        return candidate;
      }
    }

    throw new Error("Unable to find the Codex CLI.");
  }

  function setStatus(status, l10nId) {
    statusValue.dataset.status = status;
    statusValue.textContent = fallbackStatusText(l10nId);
    if (document.l10n?.setAttributes) {
      document.l10n.setAttributes(statusValue, `${L10N_PREFIX}-${l10nId}`);
      void document.l10n
        ?.translateElements?.([statusValue])
        ?.catch(() => undefined);
    }
  }

  function fallbackStatusText(l10nId) {
    switch (l10nId) {
      case "pref-codex-status-connected":
        return "检测到且连接成功";
      case "pref-codex-status-missing":
        return "未检测到";
      default:
        return "";
    }
  }

  function getSubprocess() {
    return ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ).Subprocess;
  }

  function getUserHomeDirectory(environment) {
    return environment.HOME;
  }
})();
