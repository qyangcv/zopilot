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
import { waitForSubprocessResult } from "../../../runtime/process/subprocess";

export {
  buildByokRuntimeEnvironment,
  createNodeVersionProbe,
  resolveNodeBinaryPath,
  type ByokRuntimeSubprocessModule,
};

type ByokRuntimeSubprocessModule = EnvironmentSubprocessModule;
type NodeVersionProbe = (path: string) => Promise<number | undefined>;

const NODE_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
] as const;
const WINDOWS_NODE_BINARY_NAMES = ["node.exe"] as const;
const MINIMUM_NODE_MAJOR = 22;

async function buildByokRuntimeEnvironment(
  subprocess: ByokRuntimeSubprocessModule,
): Promise<Record<string, string>> {
  return buildSubprocessEnvironment(subprocess);
}

async function resolveNodeBinaryPath(
  pathValue?: string,
  os = getSubprocessDiscoveryOS(),
  probeVersion?: NodeVersionProbe,
): Promise<string> {
  const candidates = [
    ...buildDefaultNodeCandidates(os),
    ...buildPathCandidates(pathValue, os),
  ];
  let foundNode = false;
  for (const candidate of Array.from(new Set(candidates))) {
    if (!(await pathExists(candidate, { whenUnavailable: false }))) {
      continue;
    }
    foundNode = true;
    const major = await probeVersion?.(candidate);
    if (major !== undefined && major >= MINIMUM_NODE_MAJOR) {
      return candidate;
    }
  }
  if (foundNode) {
    throw new Error(
      `BYOK runtime requires Node.js ${MINIMUM_NODE_MAJOR} or newer.`,
    );
  }
  throw new Error(
    `Unable to find Node.js ${MINIMUM_NODE_MAJOR} or newer for the BYOK runtime. Install a supported Node.js version so \`node\` is available on your login shell PATH.`,
  );
}

function createNodeVersionProbe(
  subprocess: ByokRuntimeSubprocessModule,
): NodeVersionProbe {
  return async (path) => {
    try {
      const proc = await subprocess.call({
        command: path,
        arguments: ["--version"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const result = await waitForSubprocessResult(proc, { timeoutMs: 5000 });
      if (result.exitCode !== 0) return undefined;
      const match = /^v?(\d+)(?:\.|$)/.exec(
        `${result.stdout}\n${result.stderr}`.trim(),
      );
      return match ? Number(match[1]) : undefined;
    } catch {
      return undefined;
    }
  };
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
