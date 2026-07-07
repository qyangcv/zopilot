import { buildCodexSubprocessEnvironment } from "../codex/cliDiscovery";
import {
  buildExecutablePathCandidates,
  detectHostRuntime,
  type HostOS,
} from "../utils/platform";

export {
  buildByokRuntimeEnvironment,
  resolveNodeBinaryPath,
  type ByokRuntimeSubprocessModule,
};

type ByokRuntimeSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<ByokRuntimeSubprocessProcess>;
  getEnvironment(): Record<string, string>;
};

type ByokRuntimeSubprocessProcess = {
  stdout: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
  kill(timeout?: number): Promise<{ exitCode: number }>;
};

const NODE_BINARY_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
] as const;
const WINDOWS_NODE_BINARY_NAMES = ["node.exe"] as const;

async function buildByokRuntimeEnvironment(
  subprocess: ByokRuntimeSubprocessModule,
): Promise<Record<string, string>> {
  return buildCodexSubprocessEnvironment(subprocess);
}

async function resolveNodeBinaryPath(
  pathValue?: string,
  os = getDiscoveryOS(),
): Promise<string> {
  for (const candidate of buildDefaultNodeCandidates(os)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of buildPathCandidates(pathValue, os)) {
    if (await pathExists(candidate)) {
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

function getDiscoveryOS(): HostOS {
  const runtime = detectHostRuntime();
  return runtime.os === "windows" ? "windows" : "macos";
}

async function pathExists(path: string): Promise<boolean> {
  const ioUtils = globalThis.IOUtils as
    | { exists(path: string): Promise<boolean> }
    | undefined;
  return Boolean(await ioUtils?.exists(path).catch(() => false));
}
