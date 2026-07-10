import { SUPPORTED_PDF_HELPER_PLATFORMS } from "../../runtime/platform/host";
import { PDF_HELPER_MANIFEST_URL, PDF_HELPER_VERSION } from "./constants";
import { installPdfHelper } from "./installer";
import { detectPdfHelperPlatform, selectPdfHelperArtifact } from "./manifest";
import {
  getInstalledPdfHelperExecutablePath,
  getPdfHelperStatus,
  isInstalledPdfHelperReady,
  removePdfHelperRuntimeDir,
} from "./status";
import type {
  PdfHelperArtifact,
  PdfHelperInstallProgress,
  PdfHelperManifest,
  PdfHelperStatus,
} from "./types";

let installPromise: Promise<string> | undefined;

async function ensurePdfHelperExecutable(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  const executable = getInstalledPdfHelperExecutablePath(platform);
  if (await isInstalledPdfHelperReady(executable, platform)) return executable;
  if (installPromise) return installPromise;
  installPromise = installPdfHelper(onProgress);
  try {
    return await installPromise;
  } finally {
    installPromise = undefined;
  }
}

async function installPdfHelperDependency(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  await ensurePdfHelperExecutable(onProgress);
  return getPdfHelperStatus();
}

async function removePdfHelperDependency(): Promise<PdfHelperStatus> {
  await removePdfHelperRuntimeDir();
  return getPdfHelperStatus();
}

async function updatePdfHelperDependency(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  await removePdfHelperRuntimeDir();
  await ensurePdfHelperExecutable(onProgress);
  return getPdfHelperStatus();
}

export {
  PDF_HELPER_MANIFEST_URL,
  SUPPORTED_PDF_HELPER_PLATFORMS,
  PDF_HELPER_VERSION,
  detectPdfHelperPlatform,
  ensurePdfHelperExecutable,
  getPdfHelperStatus,
  getInstalledPdfHelperExecutablePath,
  installPdfHelperDependency,
  removePdfHelperDependency,
  selectPdfHelperArtifact,
  updatePdfHelperDependency,
  type PdfHelperArtifact,
  type PdfHelperManifest,
  type PdfHelperInstallProgress,
  type PdfHelperStatus,
};
