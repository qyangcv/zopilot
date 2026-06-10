/* global ChromeUtils, IOUtils, Zotero, clearTimeout, document, setTimeout */

(() => {
  const PREFS_PREFIX = "extensions.zotero.zotero-copilot";
  const L10N_PREFIX = "__addonRef__";
  const COMMAND_TIMEOUT_MS = 5000;
  const MAX_INIT_ATTEMPTS = 20;

  let pathInput;
  let testButton;
  let statusValue;
  let timeoutInput;
  let testId = 0;
  let initAttempts = 0;

  init();

  function init() {
    pathInput = document.querySelector(
      'input[preference="extensions.zotero.zotero-copilot.codex.path"]',
    );
    testButton = document.getElementById("zotero-copilot-cli-test-button");
    statusValue = document.getElementById("zotero-copilot-cli-status-value");
    timeoutInput = document.getElementById("zotero-copilot-timeout-seconds");

    if (!pathInput || !testButton || !statusValue || !timeoutInput) {
      initAttempts += 1;
      if (initAttempts <= MAX_INIT_ATTEMPTS) {
        setTimeout(init, 50);
      }
      return;
    }

    applyFixedControlSizes();
    initTimeoutInput();
    testButton.addEventListener("click", () => {
      void testCodexCli();
    });
    pathInput.addEventListener("input", clearStatus);

    void detectCodexPath();
  }

  function applyFixedControlSizes() {
    setFixedWidth(pathInput, 360);
    setFixedWidth(timeoutInput, 64);
    timeoutInput.style.setProperty("appearance", "textfield", "important");
    timeoutInput.style.setProperty("-moz-appearance", "textfield", "important");
  }

  function setFixedWidth(element, width) {
    const value = `${width}px`;
    element.style.setProperty("box-sizing", "border-box", "important");
    element.style.setProperty("width", value, "important");
    element.style.setProperty("min-width", value, "important");
    element.style.setProperty("max-width", value, "important");
    element.style.setProperty("flex", `0 0 ${value}`, "important");
  }

  function initTimeoutInput() {
    const timeoutMs = Number(
      Zotero.Prefs.get(`${PREFS_PREFIX}.codex.timeoutMs`, true),
    );
    timeoutInput.value = String(Math.max(1, Math.round(timeoutMs / 1000)));
    timeoutInput.addEventListener("change", saveTimeoutSeconds);
    timeoutInput.addEventListener("input", saveTimeoutSeconds);
  }

  function saveTimeoutSeconds() {
    const seconds = Math.max(1, Number(timeoutInput.value) || 1);
    Zotero.Prefs.set(`${PREFS_PREFIX}.codex.timeoutMs`, seconds * 1000, true);
  }

  async function detectCodexPath() {
    const currentTestId = ++testId;
    setStatus("checking", "pref-codex-cli-status-detecting");

    try {
      const subprocess = getSubprocess();
      const command = await resolveCodexBinaryPath(subprocess, "");
      if (currentTestId !== testId) {
        return;
      }
      if (!getPathInputValue()) {
        pathInput.value = command;
      }
      clearStatus();
    } catch {
      if (currentTestId === testId) {
        setStatus("missing", "pref-codex-cli-status-missing");
      }
    }
  }

  async function testCodexCli() {
    const currentTestId = ++testId;
    let commandResolved = false;
    testButton.disabled = true;
    setStatus("checking", "pref-codex-cli-status-testing");

    try {
      const subprocess = getSubprocess();
      const command = await resolveCodexBinaryPath(
        subprocess,
        getPathInputValue(),
      );
      commandResolved = true;
      if (currentTestId !== testId) {
        return;
      }
      if (!getPathInputValue()) {
        pathInput.value = command;
      }

      const appServer = await runCommand(subprocess, command, [
        "app-server",
        "--help",
      ]);
      if (currentTestId !== testId) {
        return;
      }
      if (appServer.exitCode !== 0) {
        setStatus("failed", "pref-codex-cli-status-failed");
        return;
      }

      const login = await readCodexLoginStatus(subprocess, command);
      if (currentTestId !== testId) {
        return;
      }
      setStatus(
        login.loggedIn ? "success" : "logged-out",
        login.loggedIn
          ? "pref-codex-cli-status-success"
          : "pref-codex-cli-status-logged-out",
      );
    } catch {
      if (currentTestId === testId) {
        setStatus(
          commandResolved ? "failed" : "missing",
          commandResolved
            ? "pref-codex-cli-status-failed"
            : "pref-codex-cli-status-missing",
        );
      }
    } finally {
      if (currentTestId === testId) {
        testButton.disabled = false;
      }
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

  async function resolveCodexBinaryPath(subprocess, configuredPath) {
    const command = String(configuredPath || "").trim();
    if (command) {
      return resolveCommand(subprocess, command);
    }

    const environment = subprocess.getEnvironment();
    const home = getUserHomeDirectory(environment);
    const candidates = uniqueCandidates([
      "codex",
      "codex.cmd",
      "codex.exe",
      joinPath(home, ".local/bin/codex"),
      joinPath(home, ".npm-global/bin/codex"),
      joinPath(home, ".bun/bin/codex"),
      joinPath(home, ".bun/bin/codex.cmd"),
      joinPath(environment.APPDATA, "npm/codex.cmd"),
      joinPath(environment.APPDATA, "npm/codex"),
      joinPath(environment.LOCALAPPDATA, "pnpm/codex.cmd"),
      joinPath(environment.LOCALAPPDATA, "pnpm/codex"),
      joinPath(home, "AppData/Roaming/npm/codex.cmd"),
      joinPath(home, "AppData/Roaming/npm/codex"),
      joinPath(home, "AppData/Local/pnpm/codex.cmd"),
      joinPath(home, "AppData/Local/pnpm/codex"),
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
    ]);

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      try {
        if (isPathLike(candidate) && !(await IOUtils.exists(candidate))) {
          continue;
        }
        return await resolveCommand(subprocess, candidate);
      } catch {
        // Continue through the remaining common install locations.
      }
    }

    throw new Error("Unable to find the Codex CLI.");
  }

  async function resolveCommand(subprocess, command) {
    if (isPathLike(command)) {
      return expandHome(
        command,
        getUserHomeDirectory(subprocess.getEnvironment()),
      );
    }
    return subprocess.pathSearch(command);
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

  function clearStatus() {
    statusValue.textContent = "";
    statusValue.removeAttribute("data-status");
    statusValue.removeAttribute("data-l10n-id");
    statusValue.removeAttribute("data-l10n-args");
  }

  function fallbackStatusText(l10nId) {
    switch (l10nId) {
      case "pref-codex-cli-status-detecting":
        return "正在检测";
      case "pref-codex-cli-status-testing":
        return "正在测试";
      case "pref-codex-cli-status-missing":
        return "未检测到 Codex";
      case "pref-codex-cli-status-logged-out":
        return "Codex 未登录";
      case "pref-codex-cli-status-failed":
        return "Codex 连接失败";
      case "pref-codex-cli-status-success":
        return "成功";
      default:
        return "";
    }
  }

  function getPathInputValue() {
    return String(pathInput.value || "").trim();
  }

  function getSubprocess() {
    return ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ).Subprocess;
  }

  function getUserHomeDirectory(environment) {
    return environment.HOME || environment.USERPROFILE;
  }

  function expandHome(path, home) {
    if (path === "~") {
      return home || path;
    }
    if (!path.startsWith("~/") && !path.startsWith("~\\")) {
      return path;
    }
    if (!home) {
      return path;
    }
    return joinPath(home, path.slice(2)) || path;
  }

  function joinPath(base, suffix) {
    if (!base) {
      return null;
    }
    const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
    const normalizedSuffix =
      separator === "\\" ? suffix.replace(/\//g, "\\") : suffix;
    return `${base.replace(/[\\/]$/, "")}${separator}${normalizedSuffix.replace(
      /^[\\/]/,
      "",
    )}`;
  }

  function isPathLike(command) {
    return /[\\/]/.test(command) || /^[A-Za-z]:/.test(command);
  }

  function uniqueCandidates(candidates) {
    return candidates.filter(
      (candidate, index) =>
        Boolean(candidate) && candidates.indexOf(candidate) === index,
    );
  }
})();
