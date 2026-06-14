export { buildCodexSubprocessEnvironment };

const CODEX_PATH_PREFIX = ["/opt/homebrew/bin", "/usr/local/bin"] as const;

function buildCodexSubprocessEnvironment(
  baseEnvironment: Record<string, string>,
): Record<string, string> {
  return {
    PATH: mergePath(CODEX_PATH_PREFIX, baseEnvironment.PATH),
  };
}

function mergePath(prefix: readonly string[], currentPath?: string): string {
  const entries = [...prefix];
  for (const entry of currentPath?.split(":") || []) {
    if (entry && !entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries.join(":");
}
