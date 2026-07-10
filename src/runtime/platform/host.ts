export {
  SUPPORTED_PDF_HELPER_PLATFORMS,
  buildExecutablePathCandidates,
  detectHostRuntime,
  getEnvironmentPath,
  getHomeDir,
  getPathDelimiter,
  mergePathEntries,
  platformPathJoin,
  splitPathEntries,
  type HostArch,
  type HostOS,
  type HostRuntime,
  type PdfHelperPlatform,
};

type HostOS = "macos" | "windows" | "unsupported";
type HostArch = "arm64" | "x64" | "unsupported";
type PdfHelperPlatform = "macos-arm64" | "macos-x64" | "windows-x64";

type HostRuntime = {
  os: HostOS;
  arch: HostArch;
  pdfHelperPlatform?: PdfHelperPlatform;
  rawOS?: string;
  rawABI?: string;
  rawPlatform?: string;
  rawUserAgent?: string;
};

type RuntimeInfo = {
  OS?: string;
  XPCOMABI?: string;
  platform?: string;
  userAgent?: string;
};

const SUPPORTED_PDF_HELPER_PLATFORMS: readonly PdfHelperPlatform[] = [
  "macos-arm64",
  "macos-x64",
  "windows-x64",
];

function detectHostRuntime(runtime = readRuntimeInfo()): HostRuntime {
  const rawOS = runtime.OS || "";
  const rawABI = runtime.XPCOMABI || "";
  const rawPlatform = runtime.platform || "";
  const rawUserAgent = runtime.userAgent || "";
  const combined = `${rawOS} ${rawABI} ${rawPlatform} ${rawUserAgent}`;
  const os = detectHostOS(rawOS, rawPlatform, rawUserAgent);
  const arch = detectHostArch(combined);
  return {
    os,
    arch,
    pdfHelperPlatform: toPdfHelperPlatform(os, arch),
    rawOS,
    rawABI,
    rawPlatform,
    rawUserAgent,
  };
}

function getPathDelimiter(os: HostOS): ":" | ";" {
  return os === "windows" ? ";" : ":";
}

function getEnvironmentPath(environment: Record<string, string>): string {
  return environment.PATH || environment.Path || environment.path || "";
}

function getHomeDir(environment: Record<string, string>): string | undefined {
  if (environment.HOME) {
    return environment.HOME;
  }
  if (environment.USERPROFILE) {
    return environment.USERPROFILE;
  }
  if (environment.HOMEDRIVE || environment.HOMEPATH) {
    return `${environment.HOMEDRIVE || ""}${environment.HOMEPATH || ""}`;
  }
  return undefined;
}

function splitPathEntries(pathValue: string | undefined, os: HostOS): string[] {
  return (pathValue || "").split(getPathDelimiter(os)).filter(Boolean);
}

function mergePathEntries(
  prefix: readonly string[],
  currentPath: string | undefined,
  os: HostOS,
): string {
  const entries: string[] = [];
  for (const entry of [...prefix, ...splitPathEntries(currentPath, os)]) {
    if (entry && !entries.includes(entry)) {
      entries.push(entry);
    }
  }
  return entries.join(getPathDelimiter(os));
}

function buildExecutablePathCandidates(
  pathValue: string | undefined,
  executableNames: readonly string[],
  os: HostOS,
): string[] {
  const candidates: string[] = [];
  for (const entry of splitPathEntries(pathValue, os)) {
    const dir = trimPathTrailingSeparators(entry, os);
    for (const executable of executableNames) {
      const candidate = platformPathJoin(os, dir, executable);
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function platformPathJoin(os: HostOS, ...parts: string[]): string {
  const separator = os === "windows" ? "\\" : "/";
  const filtered = parts.filter((part) => part.length > 0);
  if (!filtered.length) {
    return "";
  }
  return filtered
    .map((part, index) =>
      index === 0
        ? part.replace(/[\\/]+$/u, "")
        : part.replace(/^[\\/]+|[\\/]+$/gu, ""),
    )
    .join(separator);
}

function detectHostOS(
  rawOS: string,
  rawPlatform: string,
  rawUserAgent: string,
): HostOS {
  if (
    rawOS === "Darwin" ||
    /\bMac\b/iu.test(rawPlatform) ||
    /\bMac OS X\b/iu.test(rawUserAgent)
  ) {
    return "macos";
  }
  if (
    rawOS === "WINNT" ||
    /\bWin/iu.test(rawPlatform) ||
    /\bWindows\b/iu.test(rawUserAgent)
  ) {
    return "windows";
  }
  return "unsupported";
}

function detectHostArch(value: string): HostArch {
  if (/aarch64|arm64/iu.test(value)) {
    return "arm64";
  }
  if (/x86_64|amd64|x64|win64/iu.test(value)) {
    return "x64";
  }
  return "unsupported";
}

function toPdfHelperPlatform(
  os: HostOS,
  arch: HostArch,
): PdfHelperPlatform | undefined {
  if (os === "macos" && arch === "arm64") {
    return "macos-arm64";
  }
  if (os === "macos" && arch === "x64") {
    return "macos-x64";
  }
  if (os === "windows" && arch === "x64") {
    return "windows-x64";
  }
  return undefined;
}

function trimPathTrailingSeparators(path: string, os: HostOS): string {
  if (os === "windows" && /^[A-Za-z]:[\\/]?$/u.test(path)) {
    return path.replace(/[\\/]$/u, "");
  }
  return path.replace(/[\\/]+$/u, "");
}

function readRuntimeInfo(): RuntimeInfo {
  const services = (
    globalThis as typeof globalThis & {
      Services?: {
        appinfo?: {
          OS?: string;
          XPCOMABI?: string;
        };
      };
    }
  ).Services;
  return {
    OS: services?.appinfo?.OS,
    XPCOMABI: services?.appinfo?.XPCOMABI,
    platform: globalThis.navigator?.platform,
    userAgent: globalThis.navigator?.userAgent,
  };
}
