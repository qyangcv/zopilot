import type { ConversationMetadata } from "../../../domain/conversation";
import { encodePathSegment } from "../pathCodec";
import { geckoPath } from "../../../platform/gecko";

export {
  getConversationMessagesPath,
  getConversationMetadataPath,
  getConversationWorkspaceDir,
  getDefaultConversationRootDir,
};

function getDefaultConversationRootDir(): string {
  return geckoPath.join(geckoPath.profileDir, "zopilot", "conversations");
}

function getConversationWorkspaceDir(
  rootDir: string,
  workspaceKey: string,
): string {
  return geckoPath.join(rootDir, "workspaces", encodePathSegment(workspaceKey));
}

function getConversationMetadataPath(
  rootDir: string,
  metadata: ConversationMetadata,
): string {
  return geckoPath.join(
    getConversationWorkspaceDir(rootDir, metadata.workspaceKey),
    `${metadata.id}.json`,
  );
}

function getConversationMessagesPath(
  rootDir: string,
  metadata: ConversationMetadata,
): string {
  return geckoPath.join(
    getConversationWorkspaceDir(rootDir, metadata.workspaceKey),
    `${metadata.id}.jsonl`,
  );
}
