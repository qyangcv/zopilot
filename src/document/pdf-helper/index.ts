import { SUPPORTED_PDF_HELPER_PLATFORMS } from "../../runtime/platform/host";
import { PDF_HELPER_MANIFEST_URL, PDF_HELPER_VERSION } from "./constants";
import { installPdfHelper } from "./installer";
import {
  getDevelopmentPdfHelperCommand,
  isDevelopmentPdfHelper,
  type PdfHelperCommand,
} from "./development";
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

async function getPdfHelperCommand(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperCommand> {
  if (isDevelopmentPdfHelper()) {
    return getDevelopmentPdfHelperCommand();
  }
  return {
    command: await ensurePdfHelperExecutable(onProgress),
    argumentsPrefix: [],
  };
}

async function installPdfHelperDependency(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  if (isDevelopmentPdfHelper()) return getPdfHelperStatus();
  await ensurePdfHelperExecutable(onProgress);
  return getPdfHelperStatus();
}

async function removePdfHelperDependency(): Promise<PdfHelperStatus> {
  if (isDevelopmentPdfHelper()) return getPdfHelperStatus();
  await removePdfHelperRuntimeDir();
  return getPdfHelperStatus();
}

async function updatePdfHelperDependency(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  if (isDevelopmentPdfHelper()) return getPdfHelperStatus();
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
  getPdfHelperCommand,
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
  type PdfHelperCommand,
};
