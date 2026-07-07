import { createLogger } from "../utils/logger";
import {
  SUPPORTED_PDF_HELPER_PLATFORMS,
  type PdfHelperPlatform,
} from "../utils/platform";
import {
  PDF_HELPER_MANIFEST_URL,
  PDF_HELPER_PACKAGE_NAME,
  PDF_HELPER_VERSION,
} from "./pdfHelperConstants";
import {
  detectPdfHelperPlatform,
  selectPdfHelperArtifact,
} from "./pdfHelperManifest";
import { downloadBytes, downloadJson, sha256Hex } from "./pdfHelperDownload";
import { extractAndInstallZip } from "./pdfHelperZip";
import {
  compareVersions,
  joinRelativePath,
  parseHelperInstallDirVersion,
} from "./pdfHelperPaths";
import type {
  PdfHelperArtifact,
  PdfHelperInstallProgress,
  PdfHelperManifest,
  PdfHelperStatus,
} from "./pdfHelperTypes";

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

const logger = createLogger("pdf-helper");

type ZoteroWithProfile = typeof Zotero & {
  Profile: {
    readonly dir: string;
  };
};

let installPromise: Promise<string> | undefined;

async function ensurePdfHelperExecutable(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  const executable = getInstalledPdfHelperExecutablePath(platform);
  if (await isInstalledPdfHelperReady(executable, platform)) {
    return executable;
  }
  if (installPromise) {
    return installPromise;
  }
  installPromise = installPdfHelper(onProgress);
  try {
    return await installPromise;
  } finally {
    installPromise = undefined;
  }
}

async function getPdfHelperStatus(): Promise<PdfHelperStatus> {
  const installCandidates = await getPdfHelperInstallCandidates();
  const candidateSummary = await summarizeInstallCandidates(installCandidates);
  try {
    const platform = detectPdfHelperPlatform();
    const installDir = getInstalledPdfHelperDir(platform);
    const executablePath = getInstalledPdfHelperExecutablePath(platform);
    if (await isInstalledPdfHelperReady(executablePath, platform)) {
      return {
        status: "installed",
        platform,
        version: PDF_HELPER_VERSION,
        latestVersion: PDF_HELPER_VERSION,
        installedVersion: PDF_HELPER_VERSION,
        installedVersionState: "current",
        hasInstallCandidate: true,
        needsUpdate: false,
        installCandidateDirs: installCandidates.map((item) => item.path),
        installDir,
        executablePath,
        manifestUrl: PDF_HELPER_MANIFEST_URL,
      };
    }
    if (installCandidates.length) {
      return {
        status: "outdated",
        platform,
        version: PDF_HELPER_VERSION,
        latestVersion: PDF_HELPER_VERSION,
        installedVersion: candidateSummary.version,
        installedVersionState: candidateSummary.state,
        hasInstallCandidate: true,
        needsUpdate: true,
        installCandidateDirs: installCandidates.map((item) => item.path),
        installDir,
        executablePath,
        manifestUrl: PDF_HELPER_MANIFEST_URL,
      };
    }
    return {
      status: "not-installed",
      platform,
      version: PDF_HELPER_VERSION,
      latestVersion: PDF_HELPER_VERSION,
      hasInstallCandidate: false,
      needsUpdate: false,
      installCandidateDirs: [],
      installDir,
      executablePath,
      manifestUrl: PDF_HELPER_MANIFEST_URL,
    };
  } catch (error) {
    return {
      status: "unsupported",
      version: PDF_HELPER_VERSION,
      latestVersion: PDF_HELPER_VERSION,
      installedVersion: candidateSummary.version,
      installedVersionState: candidateSummary.state,
      hasInstallCandidate: installCandidates.length > 0,
      needsUpdate: installCandidates.length > 0,
      installCandidateDirs: installCandidates.map((item) => item.path),
      installDir: getPdfHelperRuntimeDir(),
      executablePath: "",
      manifestUrl: PDF_HELPER_MANIFEST_URL,
      reason: error instanceof Error ? error.message : String(error),
    };
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

async function removePdfHelperRuntimeDir(): Promise<void> {
  await IOUtils.remove(getPdfHelperRuntimeDir(), {
    recursive: true,
    ignoreAbsent: true,
  });
}

function getInstalledPdfHelperExecutablePath(
  platform = detectPdfHelperPlatform(),
): string {
  return PathUtils.join(
    getInstalledPdfHelperDir(platform),
    "bin",
    PDF_HELPER_PACKAGE_NAME,
    platform === "windows-x64"
      ? `${PDF_HELPER_PACKAGE_NAME}.exe`
      : PDF_HELPER_PACKAGE_NAME,
  );
}

function getInstalledPdfHelperDir(platform: PdfHelperPlatform): string {
  return PathUtils.join(
    getPdfHelperRuntimeDir(),
    `${PDF_HELPER_PACKAGE_NAME}-${platform}-v${PDF_HELPER_VERSION}`,
  );
}

type PdfHelperInstallCandidate = {
  path: string;
  version?: string;
};

async function getPdfHelperInstallCandidates(): Promise<
  PdfHelperInstallCandidate[]
> {
  const runtimeDir = getPdfHelperRuntimeDir();
  let children: string[];
  try {
    children = await IOUtils.getChildren(runtimeDir);
  } catch {
    return [];
  }
  return children
    .map((path) => ({
      path,
      version: parseHelperInstallDirVersion(path),
    }))
    .filter((item) => item.version !== undefined);
}

async function summarizeInstallCandidates(
  candidates: PdfHelperInstallCandidate[],
): Promise<{
  version?: string;
  state: "outdated" | "incomplete" | "unknown";
}> {
  if (!candidates.length) {
    return { state: "unknown" };
  }
  const sorted = [...candidates].sort((left, right) =>
    compareVersions(right.version || "", left.version || ""),
  );
  const preferred =
    sorted.find((item) => item.version === PDF_HELPER_VERSION) || sorted[0];
  if (!preferred?.version) {
    return { state: "unknown" };
  }
  const versionPath = PathUtils.join(preferred.path, "VERSION");
  const version = (await IOUtils.readUTF8(versionPath).catch(() => ""))
    .trim()
    .replace(/^v/u, "");
  const resolvedVersion = version || preferred.version;
  return {
    version: resolvedVersion,
    state: resolvedVersion === PDF_HELPER_VERSION ? "incomplete" : "outdated",
  };
}

async function installPdfHelper(
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<string> {
  const platform = detectPdfHelperPlatform();
  const installStartedAt = Date.now();
  onProgress?.({ phase: "manifest", percent: 2 });
  const manifest = await downloadJson<PdfHelperManifest>(
    PDF_HELPER_MANIFEST_URL,
  );
  const artifact = selectPdfHelperArtifact(manifest, platform);
  const runtimeDir = getPdfHelperRuntimeDir();
  const installDir = getInstalledPdfHelperDir(platform);
  const downloadDir = PathUtils.join(runtimeDir, "downloads");
  const archivePath = PathUtils.join(downloadDir, artifact.fileName);
  const finalExecutable = joinRelativePath(runtimeDir, artifact.entrypoint);
  const tempDir = PathUtils.join(
    runtimeDir,
    `.installing-${platform}-${Date.now()}`,
  );

  await IOUtils.makeDirectory(downloadDir, {
    createAncestors: true,
    ignoreExisting: true,
  });
  await IOUtils.makeDirectory(runtimeDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const archiveBytes = await downloadBytes(
    artifact.url,
    artifact.size,
    (item) => onProgress?.(item),
  );
  onProgress?.({ phase: "verify", percent: 92 });
  const actualSize = archiveBytes.byteLength;
  if (actualSize !== artifact.size) {
    throw new Error(
      `PDF helper download size mismatch: expected ${artifact.size}, got ${actualSize}.`,
    );
  }
  const actualSha256 = await sha256Hex(archiveBytes);
  if (actualSha256 !== artifact.sha256.toLowerCase()) {
    throw new Error("PDF helper download checksum mismatch.");
  }
  onProgress?.({ phase: "write", percent: 95 });
  await IOUtils.write(archivePath, archiveBytes, { flush: true });

  onProgress?.({ phase: "extract", percent: 97 });
  try {
    logger.info("pdf helper extraction started", {
      archivePath,
      installDir,
      platform,
      size: actualSize,
    });
    await extractAndInstallZip(archivePath, tempDir, installDir, artifact);
    if (!(await IOUtils.exists(finalExecutable).catch(() => false))) {
      throw new Error("PDF helper install did not produce an executable.");
    }
    logger.info("pdf helper installed", {
      durationMs: Date.now() - installStartedAt,
      executablePath: finalExecutable,
      installDir,
      platform,
      version: PDF_HELPER_VERSION,
    });
  } catch (error) {
    logger.error("pdf helper install failed", error, {
      archivePath,
      installDir,
      platform,
      tempDir,
    });
    throw error;
  } finally {
    await IOUtils.remove(tempDir, {
      recursive: true,
      ignoreAbsent: true,
    }).catch(() => undefined);
  }
  if (platform !== "windows-x64") {
    await IOUtils.setPermissions(finalExecutable, 0o755, false).catch(
      () => undefined,
    );
  }
  onProgress?.({ phase: "complete", percent: 100 });
  return finalExecutable;
}

async function isInstalledPdfHelperReady(
  executable: string,
  platform: PdfHelperPlatform,
): Promise<boolean> {
  if (!(await IOUtils.exists(executable).catch(() => false))) {
    return false;
  }
  const versionPath = PathUtils.join(
    getInstalledPdfHelperDir(platform),
    "VERSION",
  );
  const version = await IOUtils.readUTF8(versionPath).catch(() => "");
  return version.trim() === PDF_HELPER_VERSION;
}

function getPdfHelperRuntimeDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "runtime",
    "pdf-helper",
  );
}
