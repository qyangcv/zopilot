import type { CodexSubprocessModule } from "./types";

export { getUserHomeDirectory, resolveCodexBinaryPath };

type Environment = Record<string, string | undefined>;

const CODEX_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
] as const;

async function resolveCodexBinaryPath(
  _subprocess: CodexSubprocessModule,
): Promise<string> {
  for (const candidate of CODEX_BINARY_CANDIDATES) {
    if (await IOUtils.exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Unable to find the Codex CLI.",
      "Install it with Homebrew or npm -g so the binary is available at /opt/homebrew/bin/codex or /usr/local/bin/codex.",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function getUserHomeDirectory(environment: Environment): string | undefined {
  return environment.HOME;
}
