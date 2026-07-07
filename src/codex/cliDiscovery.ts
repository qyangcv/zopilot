import { waitForSubprocessResult } from "../utils/subprocess";
import {
  buildExecutablePathCandidates,
  detectHostRuntime,
  getEnvironmentPath,
  getHomeDir,
  mergePathEntries,
  platformPathJoin,
  splitPathEntries,
  type HostOS,
} from "../utils/platform";

export {
  buildCodexSubprocessEnvironment,
  resolveCodexBinaryPath,
  type CodexCommandSpec,
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
const WINDOWS_CODEX_BINARY_NAMES = ["codex.cmd", "codex.exe"] as const;
const SHELL_PATH_MARKER_START = "__ZOPILOT_PATH_START__";
const SHELL_PATH_MARKER_END = "__ZOPILOT_PATH_END__";
const SHELL_PATH_TIMEOUT_MS = 2500;

type CodexCommandSpec = {
  command: string;
  argsPrefix: string[];
  resolvedPath: string;
};

async function buildCodexSubprocessEnvironment(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<Record<string, string>> {
  const baseEnvironment = subprocess.getEnvironment();
  const os = getDiscoveryOS(baseEnvironment);
  const shellPath =
    os === "macos"
      ? await readLoginShellPath(subprocess, baseEnvironment, os)
      : undefined;
  return {
    PATH: mergePathEntries(
      [
        ...buildPathPrefix(baseEnvironment, os),
        ...splitPathEntries(shellPath, os),
      ],
      getEnvironmentPath(baseEnvironment),
      os,
    ),
  };
}

async function resolveCodexBinaryPath(
  pathValue?: string,
  os = getDiscoveryOS(),
): Promise<CodexCommandSpec> {
  for (const candidate of buildDefaultBinaryCandidates(os)) {
    if (await pathExists(candidate)) {
      return toCodexCommandSpec(candidate, os);
    }
  }
  for (const candidate of buildPathCandidates(pathValue, os)) {
    if (await pathExists(candidate)) {
      return toCodexCommandSpec(candidate, os);
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
  os: HostOS,
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
          PATH: mergePathEntries(
            CODEX_PATH_PREFIX,
            getEnvironmentPath(baseEnvironment),
            os,
          ),
        },
        environmentAppend: true,
        stdout: "pipe",
        stderr: "ignore",
        workdir: getHomeDir(baseEnvironment),
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
  const result = await waitForSubprocessResult(proc, {
    timeoutMs: SHELL_PATH_TIMEOUT_MS,
    killTimeoutMs: 500,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
  };
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
  os: HostOS,
): string[] {
  const home = getHomeDir(baseEnvironment);
  if (!home) {
    return [];
  }
  if (os === "windows") {
    return [
      baseEnvironment.APPDATA
        ? platformPathJoin(os, baseEnvironment.APPDATA, "npm")
        : "",
      baseEnvironment.LOCALAPPDATA
        ? platformPathJoin(
            os,
            baseEnvironment.LOCALAPPDATA,
            "Programs",
            "nodejs",
          )
        : "",
      baseEnvironment.ProgramFiles
        ? platformPathJoin(os, baseEnvironment.ProgramFiles, "nodejs")
        : "",
    ].filter(Boolean);
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

function buildPathPrefix(
  baseEnvironment: Record<string, string>,
  os: HostOS,
): string[] {
  if (os === "windows") {
    return buildHomePathCandidates(baseEnvironment, os);
  }
  return [
    ...CODEX_PATH_PREFIX,
    ...buildHomePathCandidates(baseEnvironment, os),
  ];
}

function buildDefaultBinaryCandidates(os: HostOS): string[] {
  if (os === "windows") {
    return [];
  }
  return [...CODEX_BINARY_CANDIDATES];
}

function buildPathCandidates(
  pathValue: string | undefined,
  os: HostOS,
): string[] {
  const names = os === "windows" ? WINDOWS_CODEX_BINARY_NAMES : ["codex"];
  return buildExecutablePathCandidates(pathValue, names, os);
}

function toCodexCommandSpec(path: string, os: HostOS): CodexCommandSpec {
  if (os === "windows" && /\.cmd$/iu.test(path)) {
    return {
      command: "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", path],
      resolvedPath: path,
    };
  }
  return {
    command: path,
    argsPrefix: [],
    resolvedPath: path,
  };
}

function getDiscoveryOS(environment?: Record<string, string>): HostOS {
  if (
    environment &&
    (environment.OS === "Windows_NT" ||
      Boolean(environment.WINDIR || environment.SystemRoot))
  ) {
    return "windows";
  }
  const runtime = detectHostRuntime();
  return runtime.os === "windows" ? "windows" : "macos";
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
