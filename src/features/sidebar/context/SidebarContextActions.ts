import type { LocalAttachmentRef } from "../../../domain/conversation";
import { createLogger } from "../../../runtime/logging/logger";
import { pickLocalAttachment } from "./attachmentUpload";
import type { ReadyDisplayState } from "../workspace/WorkspaceCoordinator";

const logger = createLogger("sidebar.contextActions");

class SidebarContextActions {
  constructor(
    private readonly win: Window,
    private readonly getReadyState: () => ReadyDisplayState | undefined,
  ) {}

  async uploadAttachment(): Promise<LocalAttachmentRef[]> {
    const ready = this.getReadyState();
    if (!ready) return [];
    try {
      const result = await pickLocalAttachment({ win: this.win });
      return result.status === "selected" ? result.attachments : [];
    } catch (error) {
      logger.error("failed to choose local attachment", error, {
        workspaceKey: ready.workspace.workspaceKey,
      });
      return [];
    }
  }

  openExternalLink(url: string): void {
    if (isSafeExternalURL(url, this.win)) Zotero.launchURL(url);
  }
}

function isSafeExternalURL(url: string, win: Window): boolean {
  try {
    return ["https:", "http:", "mailto:", "doi:"].includes(
      new win.URL(url).protocol,
    );
  } catch {
    return false;
  }
}

export { SidebarContextActions };
