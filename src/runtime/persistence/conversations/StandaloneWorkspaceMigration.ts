import type {
  Conversation,
  ConversationMessage,
  ConversationMetadata,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { createTimestampId } from "../../ids/timestampId";
import { ConversationRepository } from "./ConversationRepository";

class StandaloneWorkspaceMigration {
  constructor(private readonly repository: ConversationRepository) {}

  async run(workspace: WorkspaceIdentity): Promise<void> {
    const source = workspace.defaultSource;
    if (
      workspace.workspaceType !== "item" ||
      !source?.parentItemKey ||
      source.parentItemID === undefined
    ) {
      return;
    }
    const sourceWorkspaceKey = `item:${source.libraryID}:${source.attachmentKey}`;
    if (sourceWorkspaceKey === workspace.workspaceKey) {
      return;
    }

    const [sourceConversations, targetConversations] = await Promise.all([
      this.repository.readWorkspaceConversations(sourceWorkspaceKey),
      this.repository.readWorkspaceConversations(workspace.workspaceKey),
    ]);
    if (!sourceConversations.length) {
      return;
    }

    const existingMerge = targetConversations.find(
      (conversation) =>
        conversation.metadata.migration?.kind === "standalone-pdf-merge" &&
        conversation.metadata.migration.sourceWorkspaceKey ===
          sourceWorkspaceKey,
    );
    const existingMergeMigration =
      existingMerge?.metadata.migration?.kind === "standalone-pdf-merge"
        ? existingMerge.metadata.migration
        : undefined;
    if (existingMergeMigration?.status === "complete") {
      await this.repository.removeWorkspace(sourceWorkspaceKey);
      return;
    }

    const targetConversation = existingMergeMigration?.targetConversationId
      ? targetConversations.find(
          (conversation) =>
            conversation.metadata.id ===
            existingMergeMigration.targetConversationId,
        )
      : targetConversations
          .filter(
            (conversation) =>
              !conversation.metadata.archived &&
              !conversation.metadata.migration,
          )
          .sort((left, right) =>
            right.metadata.updatedAt.localeCompare(left.metadata.updatedAt),
          )[0];

    await this.writeBackups(
      sourceWorkspaceKey,
      workspace,
      sourceConversations,
      targetConversations,
    );

    const inputs = targetConversation
      ? [...sourceConversations, targetConversation]
      : sourceConversations;
    const mergedID = existingMerge?.metadata.id || createTimestampId("conv");
    const messages = mergeConversationMessages(inputs, mergedID);
    const newestInput = [...inputs].sort((left, right) =>
      right.metadata.updatedAt.localeCompare(left.metadata.updatedAt),
    )[0];
    const createdAt = inputs
      .map((conversation) => conversation.metadata.createdAt)
      .sort()[0];
    const preparedAt = new Date().toISOString();
    const migration = {
      kind: "standalone-pdf-merge" as const,
      sourceWorkspaceKey,
      sourceConversationIds: sourceConversations.map(
        (conversation) => conversation.metadata.id,
      ),
      targetConversationId: targetConversation?.metadata.id,
    };
    const preparedMetadata: ConversationMetadata = {
      ...workspace,
      id: mergedID,
      scope: "workspace",
      label:
        targetConversation?.metadata.label ||
        newestInput?.metadata.label ||
        new Date(preparedAt).toLocaleString(),
      createdAt: createdAt || preparedAt,
      updatedAt: preparedAt,
      latestPreview: messages.at(-1)?.text.slice(0, 160),
      backendId: newestInput?.metadata.backendId,
      providerProfileId: newestInput?.metadata.providerProfileId,
      archived: true,
      migration: {
        ...migration,
        status: "prepared",
      },
    };
    await this.repository.writeConversation(preparedMetadata, messages);

    if (targetConversation && !targetConversation.metadata.archived) {
      await this.repository.writeMetadata({
        ...targetConversation.metadata,
        archived: true,
        updatedAt: preparedAt,
      });
    }

    const completedMetadata: ConversationMetadata = {
      ...preparedMetadata,
      updatedAt: new Date().toISOString(),
      migration: {
        ...migration,
        status: "complete",
      },
    };
    delete completedMetadata.archived;
    await this.repository.writeMetadata(completedMetadata);
    await this.repository.removeWorkspace(sourceWorkspaceKey);
  }

  private async writeBackups(
    sourceWorkspaceKey: string,
    workspace: WorkspaceIdentity,
    sourceConversations: Conversation[],
    targetConversations: Conversation[],
  ): Promise<void> {
    const targetIDs = new Set(
      targetConversations.map((conversation) => conversation.metadata.id),
    );
    for (const conversation of sourceConversations) {
      const existingBackup = targetConversations.find(
        (candidate) =>
          candidate.metadata.migration?.kind === "standalone-pdf-backup" &&
          candidate.metadata.migration.sourceWorkspaceKey ===
            sourceWorkspaceKey &&
          candidate.metadata.migration.sourceConversationId ===
            conversation.metadata.id,
      );
      const id =
        existingBackup?.metadata.id ||
        (targetIDs.has(conversation.metadata.id)
          ? `migrated-${workspace.defaultSource?.attachmentKey}-${conversation.metadata.id}`
          : conversation.metadata.id);
      targetIDs.add(id);
      const metadata: ConversationMetadata = {
        ...conversation.metadata,
        ...workspace,
        id,
        archived: true,
        migration: {
          kind: "standalone-pdf-backup",
          sourceWorkspaceKey,
          sourceConversationId: conversation.metadata.id,
        },
      };
      const messages = conversation.messages.map((message) => ({
        ...message,
        conversationId: id,
      }));
      await this.repository.writeConversation(metadata, messages);
    }
  }
}

function mergeConversationMessages(
  conversations: Conversation[],
  conversationId: string,
): ConversationMessage[] {
  const seen = new Set<string>();
  return conversations
    .flatMap((conversation, conversationIndex) =>
      conversation.messages.map((message, messageIndex) => ({
        conversationIndex,
        message,
        messageIndex,
      })),
    )
    .sort(
      (left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.conversationIndex - right.conversationIndex ||
        left.messageIndex - right.messageIndex,
    )
    .filter(({ message }) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })
    .map(({ message }) => ({
      ...message,
      conversationId,
    }));
}

export { StandaloneWorkspaceMigration };
