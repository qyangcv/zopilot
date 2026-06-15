export { resolveCodexBinaryPath };

import { createLogger } from "../utils/logger";

const CODEX_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
] as const;
const logger = createLogger("codex.binaryPath");

async function resolveCodexBinaryPath(pathValue?: string): Promise<string> {
  for (const candidate of CODEX_BINARY_CANDIDATES) {
    if (await IOUtils.exists(candidate)) {
      logger.debug("resolved Codex CLI from default path", {
        path: candidate,
      });
      return candidate;
    }
  }
  const pathCandidates = buildPathCandidates(pathValue);
  for (const candidate of pathCandidates) {
    if (await IOUtils.exists(candidate)) {
      logger.debug("resolved Codex CLI from prepared PATH", {
        path: candidate,
        pathCandidateCount: pathCandidates.length,
      });
      return candidate;
    }
  }

  logger.warn("Codex CLI not found", {
    defaultCandidateCount: CODEX_BINARY_CANDIDATES.length,
    pathCandidateCount: pathCandidates.length,
  });
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
