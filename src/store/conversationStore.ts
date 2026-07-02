import type {
  Conversation,
  ConversationMessage,
  ConversationMetadata,
  WorkspaceIdentity,
} from "../shared/conversation";
import { createLogger } from "../utils/logger";
import {
  getConversationMessagesPath,
  getConversationMetadataPath,
  getConversationWorkspaceDir,
  getDefaultConversationRootDir,
} from "./conversationPaths";
import {
  isConversationMetadata,
  parseConversationMessage,
} from "./conversationSchema";

export { ConversationStore, getConversationStore };

const logger = createLogger("store.conversation");

class ConversationStore {
  private readonly rootDir: string;

  constructor(rootDir = getDefaultConversationRootDir()) {
    this.rootDir = rootDir;
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
        await this.writeMetadata(metadata);
        return { metadata, messages: existing.messages };
      }
      return existing;
    }
    return this.createWorkspaceConversation(workspace);
  }

  async getLatestWorkspaceConversation(
    workspaceKey: string,
  ): Promise<Conversation | null> {
    const metadata = await this.listWorkspaceMetadata(workspaceKey);
    const latest = metadata
      .filter((item) => !item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) {
      return null;
    }
    return {
      metadata: latest,
      messages: await this.readMessages(latest),
    };
  }

  async listWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    const metadata = await this.listWorkspaceMetadata(workspaceKey);
    const activeMetadata = metadata
      .filter((item) => !item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.all(
      activeMetadata.map(async (item) => ({
        metadata: item,
        messages: await this.readMessages(item),
      })),
    );
  }

  async listArchivedWorkspaceConversations(
    workspaceKey: string,
  ): Promise<Conversation[]> {
    const metadata = await this.listWorkspaceMetadata(workspaceKey);
    const archivedMetadata = metadata
      .filter((item) => item.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return Promise.all(
      archivedMetadata.map(async (item) => ({
        metadata: item,
        messages: await this.readMessages(item),
      })),
    );
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
    await this.writeConversation(metadata, []);
    return { metadata, messages: [] };
  }

  async activateWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<Conversation> {
    const nextMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
    };
    await this.writeMetadata(nextMetadata);
    return {
      metadata: nextMetadata,
      messages: await this.readMessages(nextMetadata),
    };
  }

  async archiveWorkspaceConversation(
    metadata: ConversationMetadata,
  ): Promise<void> {
    await this.writeMetadata({
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
    await this.writeMetadata(restoredMetadata);
    return restoredMetadata;
  }

  async addMessage(
    metadata: ConversationMetadata,
    input: {
      role: ConversationMessage["role"];
      text: string;
      status?: ConversationMessage["status"];
      codexThreadId?: string;
      codexTurnId?: string;
      completedAt?: string;
      model?: string;
      reasoningEffort?: string;
      mentions?: ConversationMessage["mentions"];
    },
  ): Promise<Conversation> {
    const messages = await this.readMessages(metadata);
    const createdAt = new Date().toISOString();
    const message: ConversationMessage = {
      id: createId("msg"),
      conversationId: metadata.id,
      role: input.role,
      text: input.text,
      createdAt,
      completedAt: input.completedAt,
      codexThreadId: input.codexThreadId,
      codexTurnId: input.codexTurnId,
      status: input.status || "complete",
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      mentions: input.mentions,
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
    await this.writeConversation(nextMetadata, messages);
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
    await this.writeMetadata(nextMetadata);
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

  private async listWorkspaceMetadata(
    workspaceKey: string,
  ): Promise<ConversationMetadata[]> {
    const dir = getConversationWorkspaceDir(this.rootDir, workspaceKey);
    try {
      if (!(await IOUtils.exists(dir))) {
        return [];
      }
    } catch (error) {
      logger.error("failed to check conversation directory", error, {
        workspaceKey,
        dir,
      });
      throw error;
    }
    let children: string[];
    try {
      children = await IOUtils.getChildren(dir);
    } catch (error) {
      logger.error("failed to list conversation directory", error, {
        workspaceKey,
        dir,
      });
      throw error;
    }
    const metadataFiles = children.filter((path) => path.endsWith(".json"));
    const metadata = await Promise.all(
      metadataFiles.map((path) => this.readMetadata(path)),
    );
    return metadata.filter(
      (item): item is ConversationMetadata =>
        item?.workspaceKey === workspaceKey,
    );
  }

  private async readMetadata(path: string): Promise<ConversationMetadata> {
    let raw: unknown;
    try {
      raw = (await IOUtils.readJSON(path)) as unknown;
    } catch (error) {
      logger.error("failed to read conversation metadata", error, { path });
      throw error;
    }
    if (!isConversationMetadata(raw)) {
      const error = new Error(`Invalid Zopilot conversation metadata: ${path}`);
      logger.error("invalid conversation metadata", error, { path });
      throw error;
    }
    return raw;
  }

  private async readMessages(
    metadata: ConversationMetadata,
  ): Promise<ConversationMessage[]> {
    const path = getConversationMessagesPath(this.rootDir, metadata);
    let text: string;
    try {
      text = await IOUtils.readUTF8(path);
    } catch (error) {
      logger.error("failed to read conversation messages", error, {
        conversationId: metadata.id,
        workspaceKey: metadata.workspaceKey,
        path,
      });
      throw error;
    }
    if (!text.trim()) {
      return [];
    }
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseConversationMessage(line, path));
  }

  private async writeConversation(
    metadata: ConversationMetadata,
    messages: ConversationMessage[],
  ): Promise<void> {
    await this.ensureWorkspaceDir(metadata.workspaceKey);
    await this.writeMetadata(metadata);
    await this.atomicWriteUTF8(
      getConversationMessagesPath(this.rootDir, metadata),
      `${messages.map((message) => JSON.stringify(message)).join("\n")}${
        messages.length ? "\n" : ""
      }`,
    );
  }

  private async writeMetadata(metadata: ConversationMetadata): Promise<void> {
    await this.ensureWorkspaceDir(metadata.workspaceKey);
    await this.atomicWriteJSON(
      getConversationMetadataPath(this.rootDir, metadata),
      metadata,
    );
  }

  private async ensureWorkspaceDir(workspaceKey: string): Promise<void> {
    const dir = getConversationWorkspaceDir(this.rootDir, workspaceKey);
    try {
      await IOUtils.makeDirectory(dir, {
        createAncestors: true,
        ignoreExisting: true,
      });
    } catch (error) {
      logger.error("failed to create conversation directory", error, {
        workspaceKey,
        dir,
      });
      throw error;
    }
  }

  private async atomicWriteJSON(path: string, value: unknown): Promise<void> {
    await this.atomicWriteUTF8(path, JSON.stringify(value, null, 2));
  }

  private async atomicWriteUTF8(path: string, text: string): Promise<void> {
    const tmpPath = `${path}.${createId("tmp")}`;
    try {
      await IOUtils.writeUTF8(tmpPath, text, { flush: true });
    } catch (error) {
      logger.error("failed to write conversation temp file", error, {
        path,
        tmpPath,
      });
      throw error;
    }
    try {
      await IOUtils.move(tmpPath, path);
    } catch (firstMoveError) {
      logger.warn("conversation atomic move fallback", {
        path,
        tmpPath,
        error: String(firstMoveError),
      });
      try {
        await IOUtils.remove(path, { ignoreAbsent: true });
        await IOUtils.move(tmpPath, path);
      } catch (error) {
        logger.error("failed to move conversation temp file", error, {
          path,
          tmpPath,
        });
        throw error;
      }
    }
  }
}

let sharedStore: ConversationStore | undefined;

function getConversationStore(): ConversationStore {
  sharedStore ??= new ConversationStore();
  return sharedStore;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function defaultConversationLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}
