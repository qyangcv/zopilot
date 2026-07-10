import type { PdfHelperStatus } from "../../../document/pdf-helper/index";
import { getString } from "../../../app/localization";

export { createPdfHelperNoticeText, isPdfHelperCurrentForPrompt };

function isPdfHelperCurrentForPrompt(status: PdfHelperStatus): boolean {
  return status.status === "installed" && !status.needsUpdate;
}

function createPdfHelperNoticeText(status: PdfHelperStatus): string {
  if (status.status === "unsupported") {
    return getString("sidebar-pdf-helper-unsupported", {
      args: { reason: status.reason },
    });
  }
  if (!status.hasInstallCandidate) {
    return getString("sidebar-pdf-helper-not-installed", {
      args: { latest: status.latestVersion },
    });
  }
  return getString("sidebar-pdf-helper-update-required", {
    args: {
      installed: status.installedVersion || "unknown",
      latest: status.latestVersion,
    },
  });
}
