/* global ChromeUtils, IOUtils, Zotero, clearTimeout, document, setTimeout */

(() => {
  const PREFS_PREFIX = "extensions.zotero.zotero-copilot";
  const L10N_PREFIX = "__addonRef__";
  const LOGIN_STATUS_TIMEOUT_MS = 5000;
  const STATUS_ROW_DISPLAY = "flex";
  const MAX_INIT_ATTEMPTS = 20;

  let statusRow;
  let statusValue;
  let refreshId = 0;
  let refreshTimer = 0;
  let initAttempts = 0;

  init();

  function init() {
    statusRow = document.getElementById("zotero-copilot-cli-status-row");
    statusValue = document.getElementById("zotero-copilot-cli-status-value");
    if (!statusRow || !statusValue) {
      initAttempts += 1;
      if (initAttempts <= MAX_INIT_ATTEMPTS) {
        setTimeout(init, 50);
      }
      return;
    }

    const pathInput = document.querySelector(
      'input[preference="extensions.zotero.zotero-copilot.codex.path"]',
    );
    void refreshCliStatus();
    pathInput?.addEventListener("input", scheduleRefresh);
    pathInput?.addEventListener("change", scheduleRefresh);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void refreshCliStatus();
    }, 300);
  }

  async function refreshCliStatus() {
    const currentRefreshId = ++refreshId;
    hideStatus();

    try {
      const subprocess = ChromeUtils.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      ).Subprocess;
      const command = await resolveCodexBinaryPath(subprocess);
      const status = await readCodexLoginStatus(subprocess, command);
      if (currentRefreshId !== refreshId || !status.loggedIn) {
        return;
      }

      await setStatusText(command);
      if (currentRefreshId !== refreshId) {
        return;
      }
      statusRow.style.display = STATUS_ROW_DISPLAY;
    } catch {
      hideStatus();
    }
  }

  async function setStatusText(command) {
    const fallbackText = `已检测到 ${command}，已登录`;
    if (document.l10n?.setAttributes && document.l10n?.translateElements) {
      try {
        document.l10n.setAttributes(
          statusValue,
          `${L10N_PREFIX}-pref-codex-cli-status-logged-in`,
          { path: command },
        );
        await document.l10n.translateElements([statusValue]);
        if (statusValue.textContent) {
          return;
        }
      } catch {
        // Fall through to a direct string so the status never renders blank.
      }
    }
    statusValue.textContent = fallbackText;
  }

  function hideStatus() {
    statusRow.style.display = "none";
    statusValue.textContent = "";
    statusValue.removeAttribute("data-l10n-id");
    statusValue.removeAttribute("data-l10n-args");
  }

  async function readCodexLoginStatus(subprocess, command) {
    const proc = await subprocess.call({
      command,
      arguments: ["login", "status"],
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
      workdir: getUserHomeDirectory(subprocess.getEnvironment()),
    });

    const timeout = new Promise((resolve) => {
      setTimeout(async () => {
        await proc.kill(500).catch(() => undefined);
        resolve({ exitCode: 124, stdout: "", stderr: "" });
      }, LOGIN_STATUS_TIMEOUT_MS);
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
    const output = `${result.stdout}\n${result.stderr}`;
    return {
      loggedIn:
        result.exitCode === 0 && /logged in|authenticated/i.test(output),
    };
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

  async function resolveCodexBinaryPath(subprocess) {
    const configuredPath = String(
      Zotero.Prefs.get(`${PREFS_PREFIX}.codex.path`, true) || "",
    ).trim();
    if (configuredPath) {
      return resolveCommand(subprocess, configuredPath);
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
