import { PDF_HELPER_PACKAGE_NAME } from "./constants";

export {
  compareVersions,
  getTopLevelRelativePath,
  joinRelativePath,
  makeParentDirectory,
  normalizeZipEntryPath,
  parseHelperInstallDirVersion,
};

function parseHelperInstallDirVersion(path: string): string | undefined {
  const name = pathBaseName(path);
  const helperPattern = new RegExp(
    `^${escapeRegExp(PDF_HELPER_PACKAGE_NAME)}-.+-v(.+)$`,
    "u",
  );
  const match = helperPattern.exec(name);
  return match?.[1]?.trim() || undefined;
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

function getTopLevelRelativePath(relativePath: string): string {
  const parts = normalizeZipEntryPath(relativePath).split("/").filter(Boolean);
  if (!parts.length) {
    throw new Error(`Invalid PDF helper artifact entrypoint: ${relativePath}`);
  }
  return parts[0];
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

function pathBaseName(path: string): string {
  const parts = path.replace(/\\/gu, "/").split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
