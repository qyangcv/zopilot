import { waitForSubprocessResult } from "./subprocess";
import { getSubprocessDiscoveryOS, pathExists } from "./executableDiscovery";
import {
  getEnvironmentPath,
  getHomeDir,
  mergePathEntries,
  platformPathJoin,
  splitPathEntries,
  type HostOS,
} from "../platform/host";

type EnvironmentProbeProcess = {
  stdout: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

type EnvironmentSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<EnvironmentProbeProcess>;
  getEnvironment(): Record<string, string>;
};

const DEFAULT_EXECUTABLE_PATH_PREFIX = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;
const SHELL_PATH_MARKER_START = "__ZOPILOT_PATH_START__";
const SHELL_PATH_MARKER_END = "__ZOPILOT_PATH_END__";
const SHELL_PATH_TIMEOUT_MS = 2500;

async function buildSubprocessEnvironment(
  subprocess: EnvironmentSubprocessModule,
): Promise<Record<string, string>> {
  const baseEnvironment = subprocess.getEnvironment();
  const os = getSubprocessDiscoveryOS(baseEnvironment);
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

async function readLoginShellPath(
  subprocess: EnvironmentSubprocessModule,
  baseEnvironment: Record<string, string>,
  os: HostOS,
): Promise<string | undefined> {
  for (const shell of await getShellCandidates(baseEnvironment)) {
    try {
      const proc = await subprocess.call({
        command: shell,
        arguments: [
          "-lic",
          `printf '\n${SHELL_PATH_MARKER_START}%s${SHELL_PATH_MARKER_END}\n' "$PATH"`,
        ],
        environment: {
          PATH: mergePathEntries(
            DEFAULT_EXECUTABLE_PATH_PREFIX,
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
    if (
      !existing.includes(candidate) &&
      (await pathExists(candidate, { whenUnavailable: true }))
    ) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function waitForPathProbe(
  proc: EnvironmentProbeProcess,
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
    ...DEFAULT_EXECUTABLE_PATH_PREFIX,
    ...buildHomePathCandidates(baseEnvironment, os),
  ];
}

export { buildSubprocessEnvironment };
export type { EnvironmentProbeProcess, EnvironmentSubprocessModule };
