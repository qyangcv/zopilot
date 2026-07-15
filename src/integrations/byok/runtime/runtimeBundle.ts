import { config } from "../../../../package.json";
import { geckoIO, geckoPath } from "../../../platform/gecko";

const RUNTIME_FILE_NAME = "byok-runtime.cjs";

type ZoteroPluginRegistry = typeof Zotero & Record<string, unknown>;
type AddonInstanceWithRoot = {
  data?: { rootURI?: string };
};

async function ensureRuntimeFile(): Promise<string> {
  const runtimeDir = geckoPath.join(geckoPath.profileDir, "zopilot", "runtime");
  await geckoIO.makeDirectory(runtimeDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const runtimePath = geckoPath.join(runtimeDir, RUNTIME_FILE_NAME);
  const response = await fetch(
    getAddonRootURI() + `content/scripts/${RUNTIME_FILE_NAME}`,
  );
  if (!response.ok) {
    throw new Error(`Unable to load BYOK runtime bundle: ${response.status}`);
  }
  await geckoIO.writeUTF8(runtimePath, await response.text(), { flush: true });
  return runtimePath;
}

function getAddonRootURI(): string {
  const globals = globalThis as unknown as Record<string, unknown>;
  const globalRootURI =
    typeof globals.rootURI === "string" ? globals.rootURI : undefined;
  if (globalRootURI) {
    return globalRootURI;
  }
  const addonInstance = (Zotero as ZoteroPluginRegistry)[
    config.addonInstance
  ] as AddonInstanceWithRoot | undefined;
  const storedRootURI = addonInstance?.data?.rootURI;
  if (storedRootURI) {
    return storedRootURI;
  }
  throw new Error("BYOK runtime bundle root URI is unavailable.");
}

export { ensureRuntimeFile };
