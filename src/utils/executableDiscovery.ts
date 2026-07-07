import { detectHostRuntime, type HostOS } from "./platform";

export { getSubprocessDiscoveryOS, pathExists };

function getSubprocessDiscoveryOS(
  environment?: Record<string, string>,
): HostOS {
  if (
    environment &&
    (environment.OS === "Windows_NT" ||
      Boolean(environment.WINDIR || environment.SystemRoot))
  ) {
    return "windows";
  }
  const runtime = detectHostRuntime();
  return runtime.os === "windows" ? "windows" : "macos";
}

async function pathExists(
  path: string,
  options: { whenUnavailable: boolean },
): Promise<boolean> {
  const ioUtils = globalThis.IOUtils as
    | { exists(path: string): Promise<boolean> }
    | undefined;
  if (!ioUtils?.exists) {
    return options.whenUnavailable;
  }
  return ioUtils.exists(path).catch(() => false);
}
