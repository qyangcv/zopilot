import type { CodexSubprocessModule } from "./types";
import { getPref } from "../utils/prefs";

export { getUserHomeDirectory, resolveCodexBinaryPath };

type Environment = Record<string, string | undefined>;

async function resolveCodexBinaryPath(
  subprocess: CodexSubprocessModule,
): Promise<string> {
  const configuredPath = String(getPref("codex.path") || "").trim();
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

  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      if (isPathLike(candidate) && !(await IOUtils.exists(candidate))) {
        continue;
      }
      return await resolveCommand(subprocess, candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    [
      "Unable to find the Codex CLI.",
      "Set the codex.path preference to the full path from `command -v codex`, `where codex`, or `where.exe codex`.",
      lastError instanceof Error ? lastError.message : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

async function resolveCommand(
  subprocess: CodexSubprocessModule,
  command: string,
): Promise<string> {
  if (isPathLike(command)) {
    return expandHome(
      command,
      getUserHomeDirectory(subprocess.getEnvironment()),
    );
  }
  return subprocess.pathSearch(command);
}

function getUserHomeDirectory(environment: Environment): string | undefined {
  return environment.HOME || environment.USERPROFILE;
}

function expandHome(path: string, home?: string): string {
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

function joinPath(base: string | undefined, suffix: string): string | null {
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

function isPathLike(command: string): boolean {
  return /[\\/]/.test(command) || /^[A-Za-z]:/.test(command);
}

function uniqueCandidates(candidates: Array<string | null>): string[] {
  return candidates.filter(
    (candidate, index): candidate is string =>
      Boolean(candidate) && candidates.indexOf(candidate) === index,
  );
}
