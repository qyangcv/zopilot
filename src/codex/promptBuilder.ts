import type { PaperPromptContext } from "../zotero/types";

export { buildPaperQuestionPrompt };

function buildPaperQuestionPrompt(
  userQuestion: string,
  context: PaperPromptContext,
): string {
  const metadata = context.metadata;
  const attachment = context.attachment;
  const selection = context.selection.text || "(none)";
  const warnings = context.warnings.length
    ? context.warnings.map((warning) => `- ${warning}`).join("\n")
    : "(none)";

  return [
    "You are answering a question from Zotero Copilot about the currently open Zotero paper.",
    "Use the Zotero context below when it is relevant. If the context is missing or insufficient, say so explicitly instead of inventing paper-specific facts.",
    "When paper-specific content beyond the metadata, abstract, selected text, and full-text status is needed, call the Zotero MCP tool `paper_read`. Treat `paper_read` results as evidence, not as final answers.",
    "Answer in the same language as the user's question unless the user asks otherwise.",
    "",
    "Current Zotero paper:",
    `Scope: ${context.scope ? "active PDF reader" : "none"}`,
    `Title: ${metadata?.title || "(unknown)"}`,
    `Authors: ${metadata?.creators.join(", ") || "(unknown)"}`,
    `Year: ${metadata?.year || "(unknown)"}`,
    `DOI: ${metadata?.doi || "(unknown)"}`,
    `Item ID: ${metadata?.itemID || "(unknown)"}`,
    `Library ID: ${metadata?.libraryID || "(unknown)"}`,
    `Item key: ${metadata?.key || "(unknown)"}`,
    "",
    "Abstract:",
    metadata?.abstract || "(none)",
    "",
    "PDF attachment:",
    `Attachment ID: ${attachment?.itemID || "(unknown)"}`,
    `Content type: ${attachment?.contentType || "(unknown)"}`,
    `Readable local file: ${attachment ? String(attachment.readable) : "false"}`,
    `Full-text status: ${context.text.status}`,
    `Full-text length: ${context.text.length}`,
    "",
    "Reader selected text:",
    selection,
    "",
    "Context warnings:",
    warnings,
    "",
    "User question:",
    userQuestion,
  ].join("\n");
}
