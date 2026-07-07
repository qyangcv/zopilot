import { createLogger } from "../utils/logger";
import type { PdfHelperArtifact } from "./pdfHelperTypes";
import {
  getTopLevelRelativePath,
  joinRelativePath,
  makeParentDirectory,
  normalizeZipEntryPath,
} from "./pdfHelperPaths";

export { extractAndInstallZip };

const ZIP_EXTRACT_TIMEOUT_MS = 120_000;
const ZIP_READER_CONTRACT_ID = "@mozilla.org/libjar/zip-reader;1";
const LOCAL_FILE_CONTRACT_ID = "@mozilla.org/file/local;1";

const logger = createLogger("pdf-helper");

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
