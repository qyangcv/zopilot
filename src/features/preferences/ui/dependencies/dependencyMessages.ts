import type { FluentMessageId } from "../../../../../typings/i10n";
import { localized, type LocalizedMessage } from "../../localization";

export { dependencyErrorMessage, unsupportedDependencyMessage };
export type { DependencyOperation };

type DependencyOperation = "check" | "install" | "remove";

const FALLBACK_MESSAGE_IDS: Record<DependencyOperation, FluentMessageId> = {
  check: "pref-dependencies-error-check-failed",
  install: "pref-dependencies-error-install-failed",
  remove: "pref-dependencies-error-remove-failed",
};

function dependencyErrorMessage(
  error: unknown,
  operation: DependencyOperation,
): LocalizedMessage {
  const text = error instanceof Error ? error.message : String(error);
  const lower = text.toLowerCase();
  if (/permission denied|eacces|eperm/u.test(lower)) {
    return localized("pref-dependencies-error-permission-denied");
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("econn")
  ) {
    return localized("pref-dependencies-error-network");
  }
  if (lower.includes("manifest download")) {
    return localized("pref-dependencies-error-manifest-download");
  }
  if (lower.includes("archive download")) {
    return localized("pref-dependencies-error-archive-download");
  }
  if (lower.includes("checksum") || lower.includes("size mismatch")) {
    return localized("pref-dependencies-error-verification");
  }
  if (
    lower.includes("manifest schema") ||
    lower.includes("manifest version") ||
    lower.includes("artifact is available")
  ) {
    return localized("pref-dependencies-error-manifest-invalid");
  }
  if (
    lower.includes("extraction") ||
    lower.includes("zip") ||
    lower.includes("entrypoint")
  ) {
    return localized("pref-dependencies-error-extraction");
  }
  if (lower.includes("executable")) {
    return localized("pref-dependencies-error-install-incomplete");
  }
  return localized(FALLBACK_MESSAGE_IDS[operation]);
}

function unsupportedDependencyMessage(): LocalizedMessage {
  return localized("pref-dependencies-unsupported-platform-reason");
}
