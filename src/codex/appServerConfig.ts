export { buildCodexAppServerArguments };

const CODEX_APP_SERVER_ARGUMENTS = [
  "app-server",
  "--stdio",
  "-c",
  'plugins."zotero@openai-curated".enabled=false',
  "-c",
  "mcp_servers.llm_for_zotero.enabled=false",
] as const;

function buildCodexAppServerArguments(): string[] {
  return [...CODEX_APP_SERVER_ARGUMENTS];
}
