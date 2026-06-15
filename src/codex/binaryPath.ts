export { resolveCodexBinaryPath };

const CODEX_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
] as const;

async function resolveCodexBinaryPath(pathValue?: string): Promise<string> {
  for (const candidate of CODEX_BINARY_CANDIDATES) {
    if (await IOUtils.exists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of buildPathCandidates(pathValue)) {
    if (await IOUtils.exists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Unable to find the Codex CLI.",
      "Install it with Homebrew or npm -g so the binary is available on your login shell PATH.",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function buildPathCandidates(pathValue?: string): string[] {
  const candidates: string[] = [];
  for (const entry of pathValue?.split(":") || []) {
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
