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

type CodexCommandSpec = {
  command: string;
  argsPrefix: string[];
  resolvedPath: string;
};

async function buildCodexSubprocessEnvironment(
  subprocess: CodexDiscoverySubprocessModule,
): Promise<Record<string, string>> {
  return buildSubprocessEnvironment(subprocess);
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
