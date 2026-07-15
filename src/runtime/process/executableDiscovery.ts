import { detectHostRuntime, type HostOS } from "../platform/host";
import { geckoIO, hasGeckoIO } from "../../platform/gecko";

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
  if (!hasGeckoIO()) {
    return options.whenUnavailable;
  }
  return geckoIO.exists(path).catch(() => false);
}
