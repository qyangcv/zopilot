import {
  getSubprocessDiscoveryOS,
  pathExists,
} from "../../runtime/process/executableDiscovery";
import {
  buildExecutablePathCandidates,
  type HostOS,
} from "../../runtime/platform/host";
import {
  buildSubprocessEnvironment,
  type EnvironmentProbeProcess,
  type EnvironmentSubprocessModule,
} from "../../runtime/process/environment";

export {
  buildCodexSubprocessEnvironment,
  resolveCodexBinaryPath,
  type CodexCommandSpec,
  type CodexDiscoverySubprocessModule,
  type CodexDiscoverySubprocessProcess,
};

type CodexDiscoverySubprocessModule = EnvironmentSubprocessModule;
type CodexDiscoverySubprocessProcess = EnvironmentProbeProcess;

const CODEX_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
] as const;
const WINDOWS_CODEX_BINARY_NAMES = ["codex.cmd", "codex.exe"] as const;
const LOOPBACK_NO_PROXY_HOSTS = ["127.0.0.1", "localhost", "::1"] as const;

type CodexCommandSpec = {
  command: string;
  argsPrefix: string[];
  resolvedPath: string;
};

async function buildCodexSubprocessEnvironment(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<Record<string, string>> {
  const environment = await buildSubprocessEnvironment(subprocess);
  const inherited = subprocess.getEnvironment();
  const noProxy = mergeNoProxyValues(
    inherited.NO_PROXY,
    inherited.no_proxy,
    ...LOOPBACK_NO_PROXY_HOSTS,
  );
  return {
    ...environment,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  };
}

function mergeNoProxyValues(...values: Array<string | undefined>): string {
  const entries: string[] = [];
  const normalized = new Set<string>();
  for (const value of values) {
    for (const entry of value?.split(",") || []) {
      const trimmed = entry.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || normalized.has(key)) continue;
      normalized.add(key);
      entries.push(trimmed);
    }
  }
  return entries.join(",");
}

async function resolveCodexBinaryPath(
  pathValue?: string,
  os = getSubprocessDiscoveryOS(),
): Promise<CodexCommandSpec> {
  for (const candidate of buildDefaultBinaryCandidates(os)) {
    if (await pathExists(candidate, { whenUnavailable: true })) {
      return toCodexCommandSpec(candidate, os);
    }
  }
  for (const candidate of buildPathCandidates(pathValue, os)) {
    if (await pathExists(candidate, { whenUnavailable: true })) {
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
