/* global ChromeUtils, IOUtils, clearTimeout, document, setTimeout */

(() => {
  const L10N_PREFIX = "__addonRef__";
  const COMMAND_TIMEOUT_MS = 5000;
  const MAX_INIT_ATTEMPTS = 50;
  const CODEX_PATH_PREFIX = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const SHELL_PATH_MARKER_START = "__ZOPILOT_PATH_START__";
  const SHELL_PATH_MARKER_END = "__ZOPILOT_PATH_END__";
  const SHELL_PATH_TIMEOUT_MS = 2500;

  let statusValue;
  let initAttempts = 0;
  let initialized = false;

  // Zotero loads pane scripts before inserting the XHTML fragment.
  scheduleInit();

  function scheduleInit() {
    setTimeout(initWhenReady, 0);
  }

  function initWhenReady() {
    if (initialized) {
      return;
    }

    statusValue = document.getElementById("zopilot-codex-status-value");
    if (!statusValue) {
      initAttempts += 1;
      if (initAttempts < MAX_INIT_ATTEMPTS) {
        scheduleInit();
      }
      return;
    }

    initialized = true;
    setStatus("missing", "pref-codex-status-missing");
    void detectCodexStatus();
  }

  async function detectCodexStatus() {
    try {
      const subprocess = getSubprocess();
      const environment = await buildCodexSubprocessEnvironment(subprocess);
      const command = await resolveCodexBinaryPath(environment.PATH);

      const appServer = await runCommand(
        subprocess,
        command,
        ["app-server", "--help"],
        environment,
      );
      if (appServer.exitCode !== 0) {
        setStatus("missing", "pref-codex-status-missing");
        return;
      }

      const loggedIn = await readCodexLoginStatus(
        subprocess,
        command,
        environment,
      );
      setStatus(
        loggedIn ? "connected" : "missing",
        loggedIn ? "pref-codex-status-connected" : "pref-codex-status-missing",
      );
    } catch {
      setStatus("missing", "pref-codex-status-missing");
    }
  }

  async function readCodexLoginStatus(subprocess, command, environment) {
    const result = await runCommand(
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

  async function runCommand(subprocess, command, args, environment) {
    const proc = await subprocess.call({
      command,
      arguments: args,
      environment,
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
      workdir: subprocess.getEnvironment().HOME,
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

  async function buildCodexSubprocessEnvironment(subprocess) {
    const baseEnvironment = subprocess.getEnvironment();
    const shellPath = await readLoginShellPath(subprocess, baseEnvironment);
    return {
      PATH: mergePath(
        [
          ...CODEX_PATH_PREFIX,
          ...buildHomePathCandidates(baseEnvironment),
          ...splitPath(shellPath),
        ],
        baseEnvironment.PATH,
      ),
    };
  }

  async function readLoginShellPath(subprocess, baseEnvironment) {
    for (const shell of await getShellCandidates(baseEnvironment)) {
      try {
        const proc = await subprocess.call({
          command: shell,
          arguments: [
            "-lic",
            `printf '\\n${SHELL_PATH_MARKER_START}%s${SHELL_PATH_MARKER_END}\\n' "$PATH"`,
          ],
          environment: {
            PATH: mergePath(CODEX_PATH_PREFIX, baseEnvironment.PATH),
          },
          environmentAppend: true,
          stdout: "pipe",
          stderr: "ignore",
          workdir: baseEnvironment.HOME,
        });
        const result = await waitForPathProbe(proc);
        if (result.exitCode === 0) {
          const path = extractMarkedPath(result.stdout);
          if (path) {
            return path;
          }
        }
      } catch {
        // Try the next shell candidate.
      }
    }
    return undefined;
  }

  async function getShellCandidates(baseEnvironment) {
    const candidates = [
      baseEnvironment.SHELL,
      "/bin/zsh",
      "/bin/bash",
      "/bin/sh",
    ].filter((item) => item && item.startsWith("/"));
    const existing = [];
    for (const candidate of candidates) {
      if (!existing.includes(candidate) && (await pathExists(candidate))) {
        existing.push(candidate);
      }
    }
    return existing;
  }

  async function waitForPathProbe(proc) {
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(async () => {
        await proc.kill(500).catch(() => undefined);
        resolve({ exitCode: 124, stdout: "" });
      }, SHELL_PATH_TIMEOUT_MS);
    });

    const completed = Promise.all([proc.wait(), readStream(proc.stdout)]).then(
      ([waitResult, stdout]) => ({
        exitCode: waitResult.exitCode,
        stdout,
      }),
    );

    const result = await Promise.race([completed, timeout]);
    clearTimeout(timer);
    return result;
  }

  function extractMarkedPath(output) {
    const start = output.indexOf(SHELL_PATH_MARKER_START);
    const end = output.indexOf(SHELL_PATH_MARKER_END, start);
    if (start < 0 || end < 0) {
      return undefined;
    }
    return output.slice(start + SHELL_PATH_MARKER_START.length, end).trim();
  }

  function buildHomePathCandidates(baseEnvironment) {
    const home = baseEnvironment.HOME;
    if (!home) {
      return [];
    }
    return [
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      `${home}/.bun/bin`,
      `${home}/.volta/bin`,
      `${home}/.local/share/mise/shims`,
      `${home}/.nvm/current/bin`,
    ];
  }

  function mergePath(prefix, currentPath) {
    const entries = [];
    for (const entry of [...prefix, ...splitPath(currentPath)]) {
      if (entry && !entries.includes(entry)) {
        entries.push(entry);
      }
    }
    return entries.join(":");
  }

  function splitPath(path) {
    return path ? path.split(":").filter(Boolean) : [];
  }

  async function pathExists(path) {
    return IOUtils.exists(path).catch(() => false);
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

  async function resolveCodexBinaryPath(pathValue) {
    const candidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"];
    for (const candidate of candidates) {
      if (await IOUtils.exists(candidate)) {
        return candidate;
      }
    }
    for (const candidate of buildPathCandidates(pathValue)) {
      if (await IOUtils.exists(candidate)) {
        return candidate;
      }
    }

    throw new Error("Unable to find the Codex CLI.");
  }

  function buildPathCandidates(pathValue) {
    const candidates = [];
    for (const entry of pathValue ? pathValue.split(":") : []) {
      if (!entry) {
        continue;
      }
      const candidate = `${entry.replace(/\/+$/, "")}/codex`;
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  function setStatus(status, l10nId) {
    statusValue.dataset.status = status;
    statusValue.textContent = "";
    if (document.l10n?.setAttributes) {
      document.l10n.setAttributes(statusValue, `${L10N_PREFIX}-${l10nId}`);
      void document.l10n
        ?.translateElements?.([statusValue])
        ?.catch(() => undefined);
    }
  }

  function getSubprocess() {
    return ChromeUtils.importESModule(
      "resource://gre/modules/Subprocess.sys.mjs",
    ).Subprocess;
  }
})();
