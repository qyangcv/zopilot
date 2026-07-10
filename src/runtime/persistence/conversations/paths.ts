import type { ConversationMetadata } from "../../../domain/conversation";
import { encodePathSegment } from "../pathCodec";

export {
  getConversationMessagesPath,
  getConversationMetadataPath,
  getConversationWorkspaceDir,
  getDefaultConversationRootDir,
};

type ZoteroWithProfile = typeof Zotero & {
  Profile: {
    readonly dir: string;
  };
};

function getDefaultConversationRootDir(): string {
  return PathUtils.join(
    (Zotero as ZoteroWithProfile).Profile.dir,
    "zopilot",
    "conversations",
  );
}

function getConversationWorkspaceDir(
  rootDir: string,
  workspaceKey: string,
): string {
  return PathUtils.join(rootDir, "workspaces", encodePathSegment(workspaceKey));
}

function getConversationMetadataPath(
  rootDir: string,
  metadata: ConversationMetadata,
): string {
  return PathUtils.join(
    getConversationWorkspaceDir(rootDir, metadata.workspaceKey),
    `${metadata.id}.json`,
  );
}

function getConversationMessagesPath(
  rootDir: string,
  metadata: ConversationMetadata,
): string {
  return PathUtils.join(
    getConversationWorkspaceDir(rootDir, metadata.workspaceKey),
    `${metadata.id}.jsonl`,
  );
}
