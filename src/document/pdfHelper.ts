import { createLogger } from "../utils/logger";
import {
  SUPPORTED_PDF_HELPER_PLATFORMS,
  detectHostRuntime,
  type PdfHelperPlatform,
} from "../utils/platform";

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
  type PdfHelperSubprocessModule,
};

const PDF_HELPER_VERSION = "0.2.0";
const PDF_HELPER_MANIFEST_URL = `https://github.com/qyangcv/zopilot/releases/download/pdf-helper-v${PDF_HELPER_VERSION}/pdf-helper-manifest.json`;
const PDF_HELPER_PACKAGE_NAME = "zopilot-pdf-helper";
const ZIP_EXTRACT_TIMEOUT_MS = 120_000;
const ZIP_READER_CONTRACT_ID = "@mozilla.org/libjar/zip-reader;1";
const LOCAL_FILE_CONTRACT_ID = "@mozilla.org/file/local;1";

const logger = createLogger("pdf-helper");

type PdfHelperArtifact = {
  platform: PdfHelperPlatform;
  fileName: string;
  url: string;
  sha256: string;
  size: number;
  entrypoint: string;
};

type PdfHelperManifest = {
  schemaVersion: 2;
  version: string;
  artifacts: PdfHelperArtifact[];
};

type PdfHelperStatus =
  | {
      status: "installed";
      platform: PdfHelperPlatform;
      version: string;
      latestVersion: string;
      installedVersion: string;
      installedVersionState: "current";
      hasInstallCandidate: true;
      needsUpdate: false;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "not-installed";
      platform: PdfHelperPlatform;
      version: string;
      latestVersion: string;
      installedVersion?: undefined;
      installedVersionState?: undefined;
      hasInstallCandidate: false;
      needsUpdate: false;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "outdated";
      platform: PdfHelperPlatform;
      version: string;
      latestVersion: string;
      installedVersion?: string;
      installedVersionState: "outdated" | "incomplete" | "unknown";
      hasInstallCandidate: true;
      needsUpdate: true;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
    }
  | {
      status: "unsupported";
      version: string;
      latestVersion: string;
      installedVersion?: string;
      installedVersionState?: "outdated" | "incomplete" | "unknown";
      hasInstallCandidate: boolean;
      needsUpdate: boolean;
      installCandidateDirs: string[];
      installDir: string;
      executablePath: string;
      manifestUrl: string;
      reason: string;
    };

type PdfHelperInstallProgress = {
  phase: "manifest" | "download" | "verify" | "write" | "extract" | "complete";
  loaded?: number;
  total?: number;
  percent?: number;
};

type PdfHelperSubprocessModule = {
  call(options: {
    command: string;
    arguments?: string[];
    environment?: Record<string, string>;
    environmentAppend?: boolean;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "stdout" | "pipe";
    workdir?: string;
  }): Promise<PdfHelperSubprocessProcess>;
};

type PdfHelperSubprocessProcess = {
  stdout?: {
    readString(length?: number | null): Promise<string>;
  };
  stderr?: {
    readString(length?: number | null): Promise<string>;
  };
  wait(): Promise<{ exitCode: number }>;
};

type ByteStreamReader = {
  read(): Promise<{ done?: boolean; value?: Uint8Array | ArrayBuffer }>;
};

type RuntimeInfo = {
  OS?: string;
  XPCOMABI?: string;
  userAgent?: string;
  platform?: string;
};

type ZoteroWithProfile = typeof Zotero & {
  Profile: {
    readonly dir: string;
  };
};

type NativeZipComponents = {
  classes: Record<
    string,
    {
      createInstance(interfaceType?: unknown): unknown;
    }
  >;
  interfaces: Record<string, unknown>;
};

type NativeLocalFile = {
  path?: string;
  initWithPath(path: string): void;
};

type NativeZipEntryEnumerator = {
  hasMore?: () => boolean;
  hasMoreElements?: () => boolean;
  getNext(): unknown;
};

type NativeZipEntry = {
  isDirectory?: boolean;
};

type NativeZipReader = {
  open(file: NativeLocalFile): void;
  close(): void;
  findEntries(pattern: string | null): NativeZipEntryEnumerator;
  getEntry(entryName: string): NativeZipEntry;
  extract(entryName: string, targetFile: NativeLocalFile): void;
};

let installPromise: Promise<string> | undefined;

async function ensurePdfHelperExecutable(
  _subprocess: PdfHelperSubprocessModule,
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
  subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  await ensurePdfHelperExecutable(subprocess, onProgress);
  return getPdfHelperStatus();
}

async function removePdfHelperDependency(): Promise<PdfHelperStatus> {
  await removePdfHelperRuntimeDir();
  return getPdfHelperStatus();
}

async function updatePdfHelperDependency(
  subprocess: PdfHelperSubprocessModule,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<PdfHelperStatus> {
  await removePdfHelperRuntimeDir();
  await ensurePdfHelperExecutable(subprocess, onProgress);
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

function parseHelperInstallDirVersion(path: string): string | undefined {
  const name = pathBaseName(path);
  const helperPattern = new RegExp(
    `^${escapeRegExp(PDF_HELPER_PACKAGE_NAME)}-.+-v(.+)$`,
    "u",
  );
  const match = helperPattern.exec(name);
  return match?.[1]?.trim() || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part) || 0);
  const rightParts = right.split(".").map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff) {
      return diff;
    }
  }
  return left.localeCompare(right);
}

function pathBaseName(path: string): string {
  const parts = path.replace(/\\/gu, "/").split("/").filter(Boolean);
  return parts.at(-1) || "";
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

async function extractAndInstallZip(
  archivePath: string,
  tempDir: string,
  installDir: string,
  artifact: PdfHelperArtifact,
): Promise<void> {
  await IOUtils.remove(tempDir, {
    recursive: true,
    ignoreAbsent: true,
  });
  await IOUtils.makeDirectory(tempDir, {
    createAncestors: true,
    ignoreExisting: true,
  });

  const extractStartedAt = Date.now();
  const result = await withTimeout(
    extractZipArchive(archivePath, tempDir),
    ZIP_EXTRACT_TIMEOUT_MS,
    `PDF helper extraction timed out after ${ZIP_EXTRACT_TIMEOUT_MS}ms.`,
  );
  logger.info("pdf helper zip extracted", {
    archivePath,
    durationMs: Date.now() - extractStartedAt,
    entries: result.entries,
    files: result.files,
  });

  const extractedInstallDir = joinRelativePath(
    tempDir,
    getTopLevelRelativePath(artifact.entrypoint),
  );
  const tempExecutable = joinRelativePath(tempDir, artifact.entrypoint);
  if (!(await IOUtils.exists(tempExecutable).catch(() => false))) {
    throw new Error("PDF helper extraction did not produce an executable.");
  }
  await replaceInstalledParserDir(extractedInstallDir, installDir);
}

async function extractZipArchive(
  archivePath: string,
  outputDir: string,
): Promise<{ entries: number; files: number }> {
  const reader = createNativeZipReader();
  let entries = 0;
  let files = 0;
  try {
    reader.open(createLocalFile(archivePath));
    const enumerator = reader.findEntries(null);
    while (zipEnumeratorHasMore(enumerator)) {
      const entryName = zipEnumeratorNext(enumerator);
      entries += 1;
      const relativePath = normalizeZipEntryPath(entryName);
      const outputPath = joinRelativePath(outputDir, relativePath);
      if (isZipDirectory(reader, entryName, relativePath)) {
        await IOUtils.makeDirectory(outputPath, {
          createAncestors: true,
          ignoreExisting: true,
        });
        continue;
      }
      await makeParentDirectory(outputDir, relativePath);
      reader.extract(entryName, createLocalFile(outputPath));
      files += 1;
    }
  } finally {
    try {
      reader.close();
    } catch {
      // Ignore close failures; extraction failures are raised from the loop.
    }
  }
  return { entries, files };
}

async function replaceInstalledParserDir(
  extractedInstallDir: string,
  installDir: string,
): Promise<void> {
  await IOUtils.remove(installDir, {
    recursive: true,
    ignoreAbsent: true,
  });
  try {
    await IOUtils.move(extractedInstallDir, installDir);
  } catch (firstMoveError) {
    logger.warn("pdf helper install move fallback", {
      error: String(firstMoveError),
      extractedInstallDir,
      installDir,
    });
    await IOUtils.remove(installDir, {
      recursive: true,
      ignoreAbsent: true,
    });
    await IOUtils.move(extractedInstallDir, installDir);
  }
}

function createNativeZipReader(): NativeZipReader {
  const components = getNativeZipComponents();
  const factory = components.classes[ZIP_READER_CONTRACT_ID];
  if (!factory) {
    throw new Error(
      "Native ZIP reader is not available in this Zotero runtime.",
    );
  }
  return factory.createInstance(
    components.interfaces.nsIZipReader,
  ) as NativeZipReader;
}

function createLocalFile(path: string): NativeLocalFile {
  const components = getNativeZipComponents();
  const factory = components.classes[LOCAL_FILE_CONTRACT_ID];
  if (!factory) {
    throw new Error(
      "Native local file API is not available in this Zotero runtime.",
    );
  }
  const file = factory.createInstance(
    components.interfaces.nsIFile,
  ) as NativeLocalFile;
  file.initWithPath(path);
  return file;
}

function getNativeZipComponents(): NativeZipComponents {
  const components = (
    globalThis as typeof globalThis & {
      Components?: NativeZipComponents;
    }
  ).Components;
  if (!components?.classes || !components.interfaces) {
    throw new Error(
      "Native ZIP APIs are not available in this Zotero runtime.",
    );
  }
  return components;
}

function zipEnumeratorHasMore(enumerator: NativeZipEntryEnumerator): boolean {
  if (typeof enumerator.hasMore === "function") {
    return enumerator.hasMore();
  }
  if (typeof enumerator.hasMoreElements === "function") {
    return enumerator.hasMoreElements();
  }
  throw new Error("Native ZIP entry enumerator is not supported.");
}

function zipEnumeratorNext(enumerator: NativeZipEntryEnumerator): string {
  const value = enumerator.getNext();
  if (typeof value === "string") {
    return value;
  }
  return String(value);
}

function isZipDirectory(
  reader: NativeZipReader,
  entryName: string,
  relativePath: string,
): boolean {
  if (relativePath.endsWith("/")) {
    return true;
  }
  return reader.getEntry(entryName).isDirectory === true;
}

function getTopLevelRelativePath(relativePath: string): string {
  const parts = normalizeZipEntryPath(relativePath).split("/").filter(Boolean);
  if (!parts.length) {
    throw new Error(`Invalid PDF helper artifact entrypoint: ${relativePath}`);
  }
  return parts[0];
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(new Error(message)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

async function downloadJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper manifest download failed (${response.status}): ${url}`,
    );
  }
  return (await response.json()) as T;
}

async function downloadBytes(
  url: string,
  expectedSize: number,
  onProgress?: (progress: PdfHelperInstallProgress) => void,
): Promise<Uint8Array> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(
      `PDF helper archive download failed (${response.status}): ${url}`,
    );
  }
  const headerSize = Number(response.headers.get("Content-Length") || 0);
  const total = headerSize || expectedSize;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({
      phase: "download",
      loaded: bytes.byteLength,
      total,
      percent: progressPercent(bytes.byteLength, total),
    });
    return bytes;
  }
  const reader = response.body.getReader() as ByteStreamReader;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    chunks.push(chunk);
    loaded += chunk.byteLength;
    onProgress?.({
      phase: "download",
      loaded,
      total,
      percent: progressPercent(loaded, total),
    });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getPdfHelperRuntimeDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "runtime",
    "pdf-helper",
  );
}

function joinRelativePath(base: string, relativePath: string): string {
  const normalized = normalizeZipEntryPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  if (
    !parts.length ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    parts.some((part) => part === "." || part === "..")
  ) {
    throw new Error(`Invalid PDF helper artifact entrypoint: ${relativePath}`);
  }
  return PathUtils.join(base, ...parts);
}

async function makeParentDirectory(
  base: string,
  relativePath: string,
): Promise<void> {
  const parts = normalizeZipEntryPath(relativePath).split("/").filter(Boolean);
  const parentParts = parts.slice(0, -1);
  if (!parentParts.length) {
    return;
  }
  await IOUtils.makeDirectory(PathUtils.join(base, ...parentParts), {
    createAncestors: true,
    ignoreExisting: true,
  });
}

function normalizeZipEntryPath(path: string): string {
  return path.replace(/\\/gu, "/");
}

function progressPercent(loaded: number, total: number): number | undefined {
  if (!total || total <= 0) {
    return undefined;
  }
  const downloadPercent = Math.min(loaded / total, 1);
  return Math.max(5, Math.min(90, Math.round(downloadPercent * 90)));
}
