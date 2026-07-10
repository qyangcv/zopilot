import {
  detectHostRuntime,
  type PdfHelperPlatform,
} from "../../runtime/platform/host";
import { PDF_HELPER_VERSION } from "./constants";
import type { PdfHelperArtifact, PdfHelperManifest } from "./types";

export { detectPdfHelperPlatform, selectPdfHelperArtifact };

type RuntimeInfo = {
  OS?: string;
  XPCOMABI?: string;
  userAgent?: string;
  platform?: string;
};

function detectPdfHelperPlatform(runtime?: RuntimeInfo): PdfHelperPlatform {
  const host = detectHostRuntime(runtime);
  if (host.pdfHelperPlatform) {
    return host.pdfHelperPlatform;
  }
  throw new Error(
    [
      "Zopilot PDF helper supports macOS arm64, macOS x64, and Windows x64.",
      `Detected OS=${host.rawOS || "unknown"} ABI=${host.rawABI || "unknown"}.`,
    ].join(" "),
  );
}

function selectPdfHelperArtifact(
  manifest: PdfHelperManifest,
  platform = detectPdfHelperPlatform(),
): PdfHelperArtifact {
  if (manifest.schemaVersion !== 2) {
    throw new Error("Unsupported PDF helper manifest schema.");
  }
  if (manifest.version !== PDF_HELPER_VERSION) {
    throw new Error(
      `Unsupported PDF helper manifest version: ${manifest.version}`,
    );
  }
  const artifact = manifest.artifacts.find(
    (item) => item.platform === platform,
  );
  if (!artifact) {
    throw new Error(`No PDF helper artifact is available for ${platform}.`);
  }
  return artifact;
}
