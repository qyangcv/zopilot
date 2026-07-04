import { buildCodexSubprocessEnvironment } from "../codex/cliDiscovery";

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

async function buildByokRuntimeEnvironment(
  subprocess: ByokRuntimeSubprocessModule,
): Promise<Record<string, string>> {
  return buildCodexSubprocessEnvironment(subprocess);
}

async function resolveNodeBinaryPath(pathValue?: string): Promise<string> {
  for (const candidate of NODE_BINARY_CANDIDATES) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  for (const candidate of buildPathCandidates(pathValue)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    "Unable to find Node.js for the BYOK runtime. Install Node.js so `node` is available on your login shell PATH.",
  );
}

function buildPathCandidates(pathValue?: string): string[] {
  return (pathValue || "")
    .split(":")
    .filter(Boolean)
    .map((dir) => `${dir.replace(/\/+$/, "")}/node`);
}

async function pathExists(path: string): Promise<boolean> {
  const ioUtils = globalThis.IOUtils as
    | { exists(path: string): Promise<boolean> }
    | undefined;
  return Boolean(await ioUtils?.exists(path).catch(() => false));
}
