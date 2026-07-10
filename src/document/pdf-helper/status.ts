import type { PdfHelperPlatform } from "../../runtime/platform/host";
import { detectPdfHelperPlatform } from "./manifest";
import {
  PDF_HELPER_MANIFEST_URL,
  PDF_HELPER_PACKAGE_NAME,
  PDF_HELPER_VERSION,
} from "./constants";
import { compareVersions, parseHelperInstallDirVersion } from "./paths";
import type { PdfHelperStatus } from "./types";

type ZoteroWithProfile = typeof Zotero & { Profile: { readonly dir: string } };
type PdfHelperInstallCandidate = { path: string; version?: string };

async function getPdfHelperStatus(): Promise<PdfHelperStatus> {
  const installCandidates = await getPdfHelperInstallCandidates();
  const candidateSummary = await summarizeInstallCandidates(installCandidates);
  try {
    const platform = detectPdfHelperPlatform();
    const installDir = getInstalledPdfHelperDir(platform);
    const executablePath = getInstalledPdfHelperExecutablePath(platform);
    const common = {
      platform,
      version: PDF_HELPER_VERSION,
      latestVersion: PDF_HELPER_VERSION,
      installCandidateDirs: installCandidates.map((item) => item.path),
      installDir,
      executablePath,
      manifestUrl: PDF_HELPER_MANIFEST_URL,
    };
    if (await isInstalledPdfHelperReady(executablePath, platform)) {
      return {
        ...common,
        status: "installed",
        installedVersion: PDF_HELPER_VERSION,
        installedVersionState: "current",
        hasInstallCandidate: true,
        needsUpdate: false,
      };
    }
    if (installCandidates.length) {
      return {
        ...common,
        status: "outdated",
        installedVersion: candidateSummary.version,
        installedVersionState: candidateSummary.state,
        hasInstallCandidate: true,
        needsUpdate: true,
      };
    }
    return {
      ...common,
      status: "not-installed",
      hasInstallCandidate: false,
      needsUpdate: false,
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

function getPdfHelperRuntimeDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "runtime",
    "pdf-helper",
  );
}

async function isInstalledPdfHelperReady(
  executable: string,
  platform: PdfHelperPlatform,
): Promise<boolean> {
  if (!(await IOUtils.exists(executable).catch(() => false))) return false;
  const versionPath = PathUtils.join(
    getInstalledPdfHelperDir(platform),
    "VERSION",
  );
  const version = await IOUtils.readUTF8(versionPath).catch(() => "");
  return version.trim() === PDF_HELPER_VERSION;
}

async function removePdfHelperRuntimeDir(): Promise<void> {
  await IOUtils.remove(getPdfHelperRuntimeDir(), {
    recursive: true,
    ignoreAbsent: true,
  });
}

async function getPdfHelperInstallCandidates(): Promise<
  PdfHelperInstallCandidate[]
> {
  let children: string[];
  try {
    children = await IOUtils.getChildren(getPdfHelperRuntimeDir());
  } catch {
    return [];
  }
  return children
    .map((path) => ({ path, version: parseHelperInstallDirVersion(path) }))
    .filter((item) => item.version !== undefined);
}

async function summarizeInstallCandidates(
  candidates: PdfHelperInstallCandidate[],
): Promise<{ version?: string; state: "outdated" | "incomplete" | "unknown" }> {
  if (!candidates.length) return { state: "unknown" };
  const sorted = [...candidates].sort((left, right) =>
    compareVersions(right.version || "", left.version || ""),
  );
  const preferred =
    sorted.find((item) => item.version === PDF_HELPER_VERSION) || sorted[0];
  if (!preferred?.version) return { state: "unknown" };
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

export {
  getInstalledPdfHelperDir,
  getInstalledPdfHelperExecutablePath,
  getPdfHelperRuntimeDir,
  getPdfHelperStatus,
  isInstalledPdfHelperReady,
  removePdfHelperRuntimeDir,
};
