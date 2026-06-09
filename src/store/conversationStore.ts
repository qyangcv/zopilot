import type {
  Conversation,
  ConversationMessage,
  ConversationMessageStatus,
  ConversationMetadata,
  PaperIdentity,
} from "../shared/conversation";

export { ConversationStore, getConversationStore };

class ConversationStore {
  private readonly rootDir: string;

  constructor(rootDir = getDefaultRootDir()) {
    this.rootDir = rootDir;
  }

  async getOrCreateLatestPaperConversation(
    paper: PaperIdentity,
  ): Promise<Conversation> {
    const existing = await this.getLatestPaperConversation(paper.paperKey);
    if (existing) {
      const metadata = this.refreshPaperSnapshot(existing.metadata, paper);
      if (metadata !== existing.metadata) {
        await this.writeMetadata(metadata);
        return { metadata, messages: existing.messages };
      }
      return existing;
    }
    return this.createPaperConversation(paper);
  }

  async getLatestPaperConversation(
    paperKey: string,
  ): Promise<Conversation | null> {
    const metadata = await this.listPaperMetadata(paperKey);
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

  async listPaperConversations(paperKey: string): Promise<Conversation[]> {
    const metadata = await this.listPaperMetadata(paperKey);
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

  async createPaperConversation(paper: PaperIdentity): Promise<Conversation> {
    const createdAt = new Date().toISOString();
    const metadata: ConversationMetadata = {
      ...paper,
      id: createId("conv"),
      scope: "paper",
      label: defaultConversationLabel(createdAt),
      createdAt,
      updatedAt: createdAt,
    };
    await this.writeConversation(metadata, []);
    return { metadata, messages: [] };
  }

  async activatePaperConversation(
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

  async archivePaperConversation(
    metadata: ConversationMetadata,
  ): Promise<void> {
    await this.writeMetadata({
      ...metadata,
      archived: true,
      updatedAt: new Date().toISOString(),
    });
  }

  async addMessage(
    metadata: ConversationMetadata,
    input: {
      role: ConversationMessage["role"];
      text: string;
      status?: ConversationMessageStatus;
      codexThreadId?: string;
      codexTurnId?: string;
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
      codexThreadId: input.codexThreadId,
      codexTurnId: input.codexTurnId,
      status: input.status || "complete",
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

  private refreshPaperSnapshot(
    metadata: ConversationMetadata,
    paper: PaperIdentity,
  ): ConversationMetadata {
    if (
      metadata.title === paper.title &&
      metadata.parentItemID === paper.parentItemID &&
      metadata.attachmentItemID === paper.attachmentItemID &&
      metadata.attachmentKey === paper.attachmentKey
    ) {
      return metadata;
    }
    return {
      ...metadata,
      ...paper,
    };
  }

  private async listPaperMetadata(
    paperKey: string,
  ): Promise<ConversationMetadata[]> {
    const dir = this.getPaperDir(paperKey);
    if (!(await IOUtils.exists(dir))) {
      return [];
    }
    const children = await IOUtils.getChildren(dir).catch(() => []);
    const metadataFiles = children.filter((path) => path.endsWith(".json"));
    const metadata = await Promise.all(
      metadataFiles.map((path) => this.readMetadata(path)),
    );
    return metadata.filter(
      (item): item is ConversationMetadata => item?.paperKey === paperKey,
    );
  }

  private async readMetadata(
    path: string,
  ): Promise<ConversationMetadata | null> {
    try {
      const raw = (await IOUtils.readJSON(path)) as unknown;
      if (!isConversationMetadata(raw)) {
        return null;
      }
      return raw;
    } catch {
      return null;
    }
  }

  private async readMessages(
    metadata: ConversationMetadata,
  ): Promise<ConversationMessage[]> {
    const path = this.getMessagesPath(metadata);
    if (!(await IOUtils.exists(path))) {
      return [];
    }
    try {
      const text = await IOUtils.readUTF8(path);
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
        .filter(isConversationMessage);
    } catch {
      return [];
    }
  }

  private async writeConversation(
    metadata: ConversationMetadata,
    messages: ConversationMessage[],
  ): Promise<void> {
    await this.ensurePaperDir(metadata.paperKey);
    await this.writeMetadata(metadata);
    await this.atomicWriteUTF8(
      this.getMessagesPath(metadata),
      `${messages.map((message) => JSON.stringify(message)).join("\n")}${
        messages.length ? "\n" : ""
      }`,
    );
  }

  private async writeMetadata(metadata: ConversationMetadata): Promise<void> {
    await this.ensurePaperDir(metadata.paperKey);
    await this.atomicWriteJSON(this.getMetadataPath(metadata), metadata);
  }

  private async ensurePaperDir(paperKey: string): Promise<void> {
    await IOUtils.makeDirectory(this.getPaperDir(paperKey), {
      createAncestors: true,
      ignoreExisting: true,
    });
  }

  private getPaperDir(paperKey: string): string {
    return PathUtils.join(this.rootDir, "papers", encodePathSegment(paperKey));
  }

  private getMetadataPath(metadata: ConversationMetadata): string {
    return PathUtils.join(
      this.getPaperDir(metadata.paperKey),
      `${metadata.id}.json`,
    );
  }

  private getMessagesPath(metadata: ConversationMetadata): string {
    return PathUtils.join(
      this.getPaperDir(metadata.paperKey),
      `${metadata.id}.jsonl`,
    );
  }

  private async atomicWriteJSON(path: string, value: unknown): Promise<void> {
    await this.atomicWriteUTF8(path, JSON.stringify(value, null, 2));
  }

  private async atomicWriteUTF8(path: string, text: string): Promise<void> {
    const tmpPath = `${path}.${createId("tmp")}`;
    await IOUtils.writeUTF8(tmpPath, text, { flush: true });
    await IOUtils.move(tmpPath, path).catch(async () => {
      await IOUtils.remove(path, { ignoreAbsent: true });
      await IOUtils.move(tmpPath, path);
    });
  }
}

let sharedStore: ConversationStore | undefined;

function getConversationStore(): ConversationStore {
  sharedStore ??= new ConversationStore();
  return sharedStore;
}

function getDefaultRootDir(): string {
  return PathUtils.join(
    Zotero.getProfileDirectory().path,
    "zotero-copilot",
    "conversations",
  );
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function defaultConversationLabel(createdAt: string): string {
  return new Date(createdAt).toLocaleString();
}

function isConversationMetadata(value: unknown): value is ConversationMetadata {
  const item = value as Partial<ConversationMetadata>;
  return (
    Boolean(item) &&
    item.scope === "paper" &&
    typeof item.id === "string" &&
    typeof item.paperKey === "string" &&
    typeof item.parentItemKey === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  const item = value as Partial<ConversationMessage>;
  return (
    Boolean(item) &&
    typeof item.id === "string" &&
    typeof item.conversationId === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.text === "string" &&
    typeof item.createdAt === "string" &&
    (item.status === "complete" || item.status === "error")
  );
}
