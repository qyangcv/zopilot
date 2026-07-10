import type {
  Conversation,
  LocalAttachmentRef,
  SourceMention,
} from "../../../domain/conversation";

export {
  buildAgentPrompt,
  buildStatelessAgentPrompt,
  buildPromptWithLocalAttachments,
  buildPromptWithSourceRefs,
};

const MAX_HISTORY_MESSAGES = 12;

function buildStatelessAgentPrompt(input: {
  conversation: Conversation;
  prompt: string;
  mentions?: SourceMention[];
  localAttachments?: LocalAttachmentRef[];
}): string {
  return [
    buildWorkspaceBlock(input.conversation),
    buildHistoryBlock(input.conversation),
    buildSourceMentionBlock(input.mentions || []),
    buildAttachmentBlock(input.localAttachments || []),
    "Current user message:",
    input.prompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const buildAgentPrompt = buildStatelessAgentPrompt;

function buildWorkspaceBlock(conversation: Conversation): string {
  const metadata = conversation.metadata;
  return [
    "Zopilot workspace:",
    JSON.stringify({
      conversationId: metadata.id,
      workspaceKey: metadata.workspaceKey,
      workspaceType: metadata.workspaceType,
      workspaceLabel: metadata.workspaceLabel,
      collectionKey: metadata.collectionKey,
      itemKey: metadata.itemKey,
      defaultSource: metadata.defaultSource
        ? {
            paperKey: metadata.defaultSource.paperKey,
            title: metadata.defaultSource.title,
            attachmentKey: metadata.defaultSource.attachmentKey,
          }
        : undefined,
    }),
  ].join("\n");
}

function buildHistoryBlock(conversation: Conversation): string {
  const history = conversation.messages
    .filter((message) => message.status !== "error")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      text: message.text,
      model: message.model,
      backendId: message.backendId,
      providerProfileId: message.providerProfileId,
    }));
  if (!history.length) {
    return "";
  }
  return [
    "Recent provider-neutral conversation history:",
    JSON.stringify(history),
  ].join("\n");
}

function buildSourceMentionBlock(mentions: SourceMention[]): string {
  if (!mentions.length) {
    return "";
  }
  return [
    "Zopilot selected sources from @ mentions:",
    JSON.stringify(
      mentions.map((mention) => ({
        sourceId: mention.sourceId,
        title: mention.title,
        paperKey: mention.paperKey,
      })),
    ),
    "When using paper_read for this question, pass sourceIds exactly as listed above.",
  ].join("\n");
}

function buildAttachmentBlock(attachments: LocalAttachmentRef[]): string {
  if (!attachments.length) {
    return "";
  }
  return [
    "Zopilot local attachments selected by the user:",
    JSON.stringify(
      attachments.map((attachment) => ({
        filename: attachment.filename,
        kind: attachment.kind,
        path: attachment.path,
        mimeType: attachment.mimeType,
      })),
    ),
    "Use these absolute file paths directly only if the selected model supports this attachment type.",
  ].join("\n");
}

function buildPromptWithSourceRefs(
  promptText: string,
  mentions: SourceMention[],
): string {
  const block = buildSourceMentionBlock(mentions);
  return block ? [promptText, block].join("\n\n") : promptText;
}

function buildPromptWithLocalAttachments(
  promptText: string,
  attachments: LocalAttachmentRef[],
): string {
  const block = buildAttachmentBlock(attachments);
  return block ? [promptText, block].join("\n\n") : promptText;
}
