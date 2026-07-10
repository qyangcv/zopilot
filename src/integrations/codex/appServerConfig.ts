export { buildCodexAppServerArguments };

const CODEX_APP_SERVER_ARGUMENTS = [
  "app-server",
  "--stdio",
  // "-c",
  // 'plugins."zotero@openai-curated".enabled=false',
] as const;

function buildCodexAppServerArguments(): string[] {
  return [...CODEX_APP_SERVER_ARGUMENTS];
}
