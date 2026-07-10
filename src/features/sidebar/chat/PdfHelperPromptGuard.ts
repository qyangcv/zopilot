import { getString } from "../../../app/localization";
import type { Conversation } from "../../../domain/conversation";
import { getPdfHelperStatus } from "../../../document/pdf-helper/index";
import { createLogger } from "../../../runtime/logging/logger";
import type { SidebarMessageView } from "../ui/types";
import {
  createPdfHelperNoticeText,
  isPdfHelperCurrentForPrompt,
} from "./pdfHelperGate";

const logger = createLogger("sidebar.pdfHelperPromptGuard");

class PdfHelperPromptGuard {
  private currentNotice?: {
    conversationId: string;
    message: SidebarMessageView;
  };

  constructor(private readonly onChange: () => void) {}

  get notice() {
    return this.currentNotice;
  }

  async ensureCurrent(conversation: Conversation): Promise<boolean> {
    try {
      const status = await getPdfHelperStatus();
      if (isPdfHelperCurrentForPrompt(status)) return true;
      this.setNotice(
        conversation.metadata.id,
        createPdfHelperNoticeText(status),
      );
      return false;
    } catch (error) {
      logger.error("failed to check pdf helper before prompt", error, {
        conversationId: conversation.metadata.id,
        workspaceKey: conversation.metadata.workspaceKey,
      });
      this.setNotice(
        conversation.metadata.id,
        getString("sidebar-pdf-helper-check-failed"),
      );
      return false;
    }
  }

  clear(conversationId: string): void {
    if (this.currentNotice?.conversationId === conversationId) {
      this.currentNotice = undefined;
      this.onChange();
    }
  }

  private setNotice(conversationId: string, text: string): void {
    this.currentNotice = {
      conversationId,
      message: {
        id: `zp-pdf-helper-notice-${conversationId}`,
        role: "assistant",
        text,
        status: "error",
        transient: true,
      },
    };
    this.onChange();
  }
}

export { PdfHelperPromptGuard };
