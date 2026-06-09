import type { PaperPromptContext } from "../zotero/types";

export { buildPaperQuestionPrompt };

function buildPaperQuestionPrompt(
  userQuestion: string,
  context: PaperPromptContext,
): string {
  const warnings = context.warnings.length
    ? context.warnings.map((warning) => `- ${warning}`).join("\n")
    : "(none)";
  const scope = context.scope;

  return [
    "Answer the Zotero paper question using `paper_read` evidence.",
    "Use the user's language unless asked otherwise.",
    "",
    // "Current Zotero reader scope:",
    // `Scope: ${context.scope ? "active PDF reader" : "none"}`,
    // `Attachment ID: ${scope?.attachmentItemID || "(unknown)"}`,
    // `Parent item ID: ${scope?.parentItemID || "(unknown)"}`,
    // `Library ID: ${scope?.libraryID || "(unknown)"}`,
    // `Full-text status: ${context.text.status}`,
    // "",
    // "Context warnings:",
    // warnings,
    // "",
    "User question:",
    userQuestion,
  ].join("\n");
}
