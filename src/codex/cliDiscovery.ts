export {
  buildCodexSubprocessEnvironment,
  resolveCodexBinaryPath,
  type CodexDiscoverySubprocessModule,
  type CodexDiscoverySubprocessProcess,
};

type CodexDiscoverySubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<CodexDiscoverySubprocessProcess>;
  getEnvironment(): Record<string, string>;
};

type CodexDiscoverySubprocessProcess = {
  stdout: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

const CODEX_PATH_PREFIX = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;
const CODEX_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
] as const;
const SHELL_PATH_MARKER_START = "__ZOPILOT_PATH_START__";
const SHELL_PATH_MARKER_END = "__ZOPILOT_PATH_END__";
const SHELL_PATH_TIMEOUT_MS = 2500;

async function buildCodexSubprocessEnvironment(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<Record<string, string>> {
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

async function resolveCodexBinaryPath(pathValue?: string): Promise<string> {
  for (const candidate of CODEX_BINARY_CANDIDATES) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of buildPathCandidates(pathValue)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Unable to find the Codex CLI.",
      "Install it with Homebrew or npm -g so the binary is available on your login shell PATH.",
    ].join(" "),
  );
}

async function readLoginShellPath(
  subprocess: CodexDiscoverySubprocessModule,
  baseEnvironment: Record<string, string>,
): Promise<string | undefined> {
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
      if (result.exitCode !== 0) {
        continue;
      }
      const path = extractMarkedPath(result.stdout);
      if (path) {
        return path;
      }
    } catch {
      // Try the next shell candidate.
    }
  }
  return undefined;
}

async function getShellCandidates(
  baseEnvironment: Record<string, string>,
): Promise<string[]> {
  const candidates = [
    baseEnvironment.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ].filter((item): item is string => Boolean(item && item.startsWith("/")));
  const existing: string[] = [];
  for (const candidate of candidates) {
    if (!existing.includes(candidate) && (await pathExists(candidate))) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function waitForPathProbe(
  proc: CodexDiscoverySubprocessProcess,
): Promise<{ exitCode: number; stdout: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ exitCode: number; stdout: string }>(
    (resolve) => {
      timer = setTimeout(async () => {
        await proc.kill(500).catch(() => undefined);
        resolve({ exitCode: 124, stdout: "" });
      }, SHELL_PATH_TIMEOUT_MS);
    },
  );
  const completed = Promise.all([proc.wait(), readStream(proc.stdout)]).then(
    ([waitResult, stdout]) => ({
      exitCode: waitResult.exitCode,
      stdout,
    }),
  );
  const result = await Promise.race([completed, timeout]);
  if (timer) {
    clearTimeout(timer);
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

function extractMarkedPath(output: string): string | undefined {
  const start = output.indexOf(SHELL_PATH_MARKER_START);
  const end = output.indexOf(SHELL_PATH_MARKER_END, start);
  if (start < 0 || end < 0) {
    return undefined;
  }
  return output.slice(start + SHELL_PATH_MARKER_START.length, end).trim();
}

function buildHomePathCandidates(
  baseEnvironment: Record<string, string>,
): string[] {
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

function buildPathCandidates(pathValue?: string): string[] {
  const candidates: string[] = [];
  for (const entry of splitPath(pathValue)) {
    const candidate = `${entry.replace(/\/+$/, "")}/codex`;
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function mergePath(prefix: readonly string[], currentPath?: string): string {
  const entries: string[] = [];
  for (const entry of [...prefix, ...splitPath(currentPath)]) {
    if (entry && !entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries.join(":");
}

function splitPath(path?: string): string[] {
  return path?.split(":").filter(Boolean) || [];
}

async function pathExists(path: string): Promise<boolean> {
  const ioUtils = globalThis.IOUtils as
    | { exists(path: string): Promise<boolean> }
    | undefined;
  if (!ioUtils?.exists) {
    return true;
  }
  return ioUtils.exists(path).catch(() => false);
}
