import { getPref } from "../utils/prefs";
import type { CodexSubprocessModule } from "./types";

export { resolveCodexBinaryPath };

async function resolveCodexBinaryPath(
  subprocess: CodexSubprocessModule,
): Promise<string> {
  const configuredPath = String(getPref("codex.path") || "").trim();
  if (configuredPath) {
    return resolveCommand(subprocess, configuredPath);
  }

  const environment = subprocess.getEnvironment();
  const candidates = [
    "codex",
    joinPath(environment.HOME, ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];

  let lastError: unknown;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      if (candidate.includes("/") && !(await IOUtils.exists(candidate))) {
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
      "Set the codex.path preference to the full path from `command -v codex`.",
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
  if (command.includes("/")) {
    return expandHome(command, subprocess.getEnvironment().HOME);
  }
  return subprocess.pathSearch(command);
}

function expandHome(path: string, home?: string): string {
  if (!path.startsWith("~/")) {
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
  return `${base.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
}
