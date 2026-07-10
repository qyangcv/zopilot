import type {
  ConversationMessage,
  ConversationMetadata,
} from "../../../domain/conversation";
import { createLogger } from "../../logging/logger";
import { AtomicFileWriter } from "./AtomicFileWriter";
import {
  getConversationMessagesPath,
  getConversationMetadataPath,
  getConversationWorkspaceDir,
} from "./paths";
import { isConversationMetadata, parseConversationMessage } from "./codec";

const logger = createLogger("store.conversationRepository");

class ConversationRepository {
  constructor(
    private readonly rootDir: string,
    private readonly writer = new AtomicFileWriter(),
  ) {}

  async listWorkspaceMetadata(
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
    const metadata = await Promise.all(
      children
        .filter((path) => path.endsWith(".json"))
        .map((path) => this.readMetadata(path)),
    );
    return metadata.filter((item) => item.workspaceKey === workspaceKey);
  }

  async readMessages(
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

  async writeConversation(
    metadata: ConversationMetadata,
    messages: ConversationMessage[],
  ): Promise<void> {
    await this.ensureWorkspaceDir(metadata.workspaceKey);
    await this.writeMetadata(metadata);
    await this.writer.writeUTF8(
      getConversationMessagesPath(this.rootDir, metadata),
      `${messages.map((message) => JSON.stringify(message)).join("\n")}${
        messages.length ? "\n" : ""
      }`,
    );
  }

  async writeMetadata(metadata: ConversationMetadata): Promise<void> {
    await this.ensureWorkspaceDir(metadata.workspaceKey);
    await this.writer.writeJSON(
      getConversationMetadataPath(this.rootDir, metadata),
      metadata,
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
}

export { ConversationRepository };
