import {
  buildSubprocessEnvironment,
  type EnvironmentSubprocessModule,
} from "../../../runtime/process/environment";
import {
  getSubprocessDiscoveryOS,
  pathExists,
} from "../../../runtime/process/executableDiscovery";
import {
  buildExecutablePathCandidates,
  type HostOS,
} from "../../../runtime/platform/host";

export {
  buildByokRuntimeEnvironment,
  resolveNodeBinaryPath,
  type ByokRuntimeSubprocessModule,
};

type ByokRuntimeSubprocessModule = EnvironmentSubprocessModule;

const NODE_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
] as const;
const WINDOWS_NODE_BINARY_NAMES = ["node.exe"] as const;

async function buildByokRuntimeEnvironment(
  subprocess: ByokRuntimeSubprocessModule,
): Promise<Record<string, string>> {
  return buildSubprocessEnvironment(subprocess);
}

async function resolveNodeBinaryPath(
  pathValue?: string,
  os = getSubprocessDiscoveryOS(),
): Promise<string> {
  for (const candidate of buildDefaultNodeCandidates(os)) {
    if (await pathExists(candidate, { whenUnavailable: false })) {
      return candidate;
    }
  }
  for (const candidate of buildPathCandidates(pathValue, os)) {
    if (await pathExists(candidate, { whenUnavailable: false })) {
      return candidate;
    }
  }
  throw new Error(
    "Unable to find Node.js for the BYOK runtime. Install Node.js so `node` is available on your login shell PATH.",
  );
}

function buildDefaultNodeCandidates(os: HostOS): string[] {
  if (os === "windows") {
    return [];
  }
  return [...NODE_BINARY_CANDIDATES];
}

function buildPathCandidates(
  pathValue: string | undefined,
  os: HostOS,
): string[] {
  const names = os === "windows" ? WINDOWS_NODE_BINARY_NAMES : ["node"];
  return buildExecutablePathCandidates(pathValue, names, os);
}
