import type {
  Conversation,
  ConversationMessage,
  ConversationMetadata,
  NoteContextRef,
  WorkspaceIdentity,
} from "../../../domain/conversation";
import { getDefaultConversationRootDir } from "./paths";
import { ConversationRepository } from "./ConversationRepository";
import { createTimestampId } from "../../ids/timestampId";

export { ConversationStore, getConversationStore };

class ConversationStore {
  private readonly repository: ConversationRepository;

  constructor(rootDir = getDefaultConversationRootDir()) {
    this.repository = new ConversationRepository(rootDir);
  }

  async getOrCreateLatestWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation> {
    const existing = await this.getLatestWorkspaceConversation(
      workspace.workspaceKey,
    );
    if (existing) {
      const metadata = this.refreshWorkspaceSnapshot(
        existing.metadata,
        workspace,
      );
      if (metadata !== existing.metadata) {
        await this.repository.writeMetadata(metadata);
        return { metadata, messages: existing.messages };
      }
      return existing;
    }
    return this.createWorkspaceConversation(workspace);
  }

  async getLatestWorkspaceConversation(
    workspaceKey: string,
  ): Promise<Conversation | null> {
    const metadata = await this.repository.listWorkspaceMetadata(workspaceKey);
    const latest = metadata
      .filter((item) => !item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) {
      return null;
    }
    return {
      metadata: latest,
      messages: await this.repository.readMessages(latest),
    };
  }

  async listWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    return this.listActiveWorkspaceConversations(workspaceKey);
  }

  async listActiveWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    const metadata = await this.repository.listWorkspaceMetadata(workspaceKey);
    const activeMetadata = metadata
      .filter((item) => !item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const conversations = await Promise.all(
      activeMetadata.map(async (item) => ({
        metadata: item,
        messages: await this.repository.readMessages(item),
      })),
    );
    return conversations.filter(hasUserMessage).sort(byLatestUserMessage);
  }

  async listArchivedWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    const metadata = await this.repository.listWorkspaceMetadata(workspaceKey);
    const archivedMetadata = metadata
      .filter((item) => item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const conversations = await Promise.all(
      archivedMetadata.map(async (item) => ({
        metadata: item,
        messages: await this.repository.readMessages(item),
      })),
    );
    return conversations.filter(hasUserMessage).sort(byLatestUserMessage);
  }

  async createWorkspaceConversation(
    workspace: WorkspaceIdentity,
  ): Promise<Conversation> {
    const createdAt = new Date().toISOString();
    const metadata: ConversationMetadata = {
      ...workspace,
      id: createId("conv"),
      scope: "workspace",
      label: defaultConversationLabel(createdAt),
      createdAt,
      updatedAt: createdAt,
    };
    await this.repository.writeConversation(metadata, []);
    return { metadata, messages: [] };
  }

  async activateWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<Conversation> {
    return this.touchConversation(metadata);
  }

  async touchConversation(
    metadata: ConversationMetadata,
  ): Promise<Conversation> {
    const nextMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.writeMetadata(nextMetadata);
    return {
      metadata: nextMetadata,
      messages: await this.repository.readMessages(nextMetadata),
    };
  }

  async archiveWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<void> {
    await this.repository.writeMetadata({
      ...metadata,
      archived: true,
      updatedAt: new Date().toISOString(),
    });
  }

  async restoreWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<ConversationMetadata> {
    const restoredMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
    };
    delete restoredMetadata.archived;
    await this.repository.writeMetadata(restoredMetadata);
    return restoredMetadata;
  }

  async addMessage(
    metadata: ConversationMetadata,
    input: {
      id?: string;
      role: ConversationMessage["role"];
      text: string;
      status?: ConversationMessage["status"];
      codexThreadId?: string;
      codexTurnId?: string;
      backendId?: string;
      backendKind?: ConversationMessage["backendKind"];
      providerProfileId?: string;
      providerBrand?: ConversationMessage["providerBrand"];
      backendRunId?: string;
      backendTurnId?: string;
      capabilitySnapshot?: ConversationMessage["capabilitySnapshot"];
      completedAt?: string;
      model?: string;
      reasoningEffort?: string;
      trace?: ConversationMessage["trace"];
      mentions?: ConversationMessage["mentions"];
      noteContexts?: ConversationMessage["noteContexts"];
      localAttachments?: ConversationMessage["localAttachments"];
    },
  ): Promise<Conversation> {
    const messages = await this.repository.readMessages(metadata);
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: input.id || createId("msg"),
      conversationId: metadata.id,
      role: input.role,
      text: input.text,
      createdAt,
      completedAt: input.completedAt,
      codexThreadId: input.codexThreadId,
      codexTurnId: input.codexTurnId,
      backendId: input.backendId,
      backendKind: input.backendKind,
      providerProfileId: input.providerProfileId,
      providerBrand: input.providerBrand,
      backendRunId: input.backendRunId,
      backendTurnId: input.backendTurnId,
      capabilitySnapshot: input.capabilitySnapshot,
      status: input.status || "complete",
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      trace: input.trace,
      mentions: input.mentions,
      noteContexts: input.noteContexts,
      localAttachments: input.localAttachments,
    };
    messages.push(message);

    const nextMetadata = {
      ...metadata,
      updatedAt: createdAt,
      latestPreview: input.text.slice(0, 160),
      label:
        metadata.label === defaultConversationLabel(metadata.createdAt) &&
        input.role === "user"
          ? input.text.slice(0, 48)
          : metadata.label,
    };
    await this.repository.writeConversation(nextMetadata, messages);
    return { metadata: nextMetadata, messages };
  }

  async updateCodexThreadId(
    metadata: ConversationMetadata,
    codexThreadId: string,
  ): Promise<ConversationMetadata> {
    if (metadata.codexThreadId === codexThreadId) {
      return metadata;
    }
    const nextMetadata = {
      ...metadata,
      codexThreadId,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.writeMetadata(nextMetadata);
    return nextMetadata;
  }

  async updateActiveNoteContexts(
    metadata: ConversationMetadata,
    noteContexts: NoteContextRef[],
  ): Promise<ConversationMetadata> {
    const persistedMetadata = (
      await this.repository.listWorkspaceMetadata(metadata.workspaceKey)
    ).find((item) => item.id === metadata.id);
    const currentMetadata = persistedMetadata || metadata;
    if (
      JSON.stringify(currentMetadata.activeNoteContexts || []) ===
      JSON.stringify(noteContexts)
    ) {
      return currentMetadata;
    }
    const nextMetadata: ConversationMetadata = {
      ...currentMetadata,
      updatedAt: new Date().toISOString(),
    };
    if (noteContexts.length) {
      nextMetadata.activeNoteContexts = noteContexts;
    } else {
      delete nextMetadata.activeNoteContexts;
    }
    await this.repository.writeMetadata(nextMetadata);
    return nextMetadata;
  }

  async updateBackendMetadata(
    metadata: ConversationMetadata,
    input: {
      backendId?: string;
      providerProfileId?: string;
      codexThreadId?: string;
    },
  ): Promise<ConversationMetadata> {
    if (
      metadata.backendId === input.backendId &&
      metadata.providerProfileId === input.providerProfileId &&
      (!input.codexThreadId || metadata.codexThreadId === input.codexThreadId)
    ) {
      return metadata;
    }
    const nextMetadata = {
      ...metadata,
      backendId: input.backendId,
      providerProfileId: input.providerProfileId,
      codexThreadId: input.codexThreadId || metadata.codexThreadId,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.writeMetadata(nextMetadata);
    return nextMetadata;
  }

  private refreshWorkspaceSnapshot(
    metadata: ConversationMetadata,
    workspace: WorkspaceIdentity,
  ): ConversationMetadata {
    const source = workspace.defaultSource;
    const currentSource = metadata.defaultSource;
    if (
      metadata.workspaceLabel === workspace.workspaceLabel &&
      metadata.workspaceTitle === workspace.workspaceTitle &&
      metadata.workspaceType === workspace.workspaceType &&
      metadata.libraryID === workspace.libraryID &&
      metadata.collectionKey === workspace.collectionKey &&
      JSON.stringify(metadata.collectionPath || []) ===
        JSON.stringify(workspace.collectionPath || []) &&
      metadata.itemKey === workspace.itemKey &&
      currentSource?.paperKey === source?.paperKey &&
      currentSource?.title === source?.title &&
      currentSource?.parentItemID === source?.parentItemID &&
      currentSource?.attachmentItemID === source?.attachmentItemID &&
      currentSource?.attachmentKey === source?.attachmentKey
    ) {
      return metadata;
    }
    return {
      ...metadata,
      ...workspace,
    };
  }
}

let sharedStore: ConversationStore | undefined;

function getConversationStore(): ConversationStore {
  sharedStore ??= new ConversationStore();
  return sharedStore;
}

function createId(prefix: string): string {
  return createTimestampId(prefix);
}

function defaultConversationLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}

function hasUserMessage(conversation: Conversation): boolean {
  return conversation.messages.some((message) => message.role === "user");
}

function byLatestUserMessage(left: Conversation, right: Conversation): number {
  const messageOrder = getLatestUserMessageAt(right).localeCompare(
    getLatestUserMessageAt(left),
  );
  return (
    messageOrder ||
    right.metadata.createdAt.localeCompare(left.metadata.createdAt) ||
    right.metadata.id.localeCompare(left.metadata.id)
  );
}

function getLatestUserMessageAt(conversation: Conversation): string {
  return (
    conversation.messages.findLast((message) => message.role === "user")
      ?.createdAt || ""
  );
}
