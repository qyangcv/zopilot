import { assert } from "chai";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
  mkdir,
  rename,
} from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ConversationStore } from "../../../src/runtime/persistence/conversations/ConversationService.ts";
import {
  createCollectionWorkspaceIdentity,
  createItemWorkspaceIdentity,
  type PaperIdentity,
} from "../../../src/domain/conversation.ts";

let rootDir: string;
const originalConsole = globalThis.console;
const originalZotero = globalThis.Zotero;

describe("ConversationStore", function () {
  beforeEach(async function () {
    rootDir = await mkdtemp(join(tmpdir(), "zp-conversations-"));
    installFileMocks();
    globalThis.console = {
      ...originalConsole,
      error: () => undefined,
      warn: () => undefined,
    };
  });

  afterEach(async function () {
    globalThis.console = originalConsole;
    restoreZoteroMock();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("persists workspace messages and keeps workspace histories isolated", async function () {
    const paperA = createPaper("1:AAA", "AAA", "Paper A");
    const paperB = createPaper("1:BBB", "BBB", "Paper B");
    const workspaceA = createItemWorkspaceIdentity(paperA);
    const workspaceB = createItemWorkspaceIdentity(paperB);
    const store = new ConversationStore(rootDir);

    let conversationA =
      await store.getOrCreateLatestWorkspaceConversation(workspaceA);
    conversationA = await store.addMessage(conversationA.metadata, {
      role: "user",
      text: "What is the method?",
    });
    const metadataA = await store.updateCodexThreadId(
      conversationA.metadata,
      "thread-a",
    );
    conversationA = await store.addMessage(metadataA, {
      role: "assistant",
      text: "The method is retrieval augmented QA.",
      codexThreadId: "thread-a",
      codexTurnId: "turn-a",
    });

    const conversationB =
      await store.getOrCreateLatestWorkspaceConversation(workspaceB);
    const reloadedStore = new ConversationStore(rootDir);
    const reloadedA = await reloadedStore.getLatestWorkspaceConversation(
      workspaceA.workspaceKey,
    );
    const reloadedB = await reloadedStore.getLatestWorkspaceConversation(
      workspaceB.workspaceKey,
    );

    assert.strictEqual(reloadedA?.metadata.id, conversationA.metadata.id);
    assert.strictEqual(reloadedA?.metadata.codexThreadId, "thread-a");
    assert.deepEqual(
      reloadedA?.messages.map((message) => [message.role, message.text]),
      [
        ["user", "What is the method?"],
        ["assistant", "The method is retrieval augmented QA."],
      ],
    );
    assert.strictEqual(reloadedB?.metadata.id, conversationB.metadata.id);
    assert.lengthOf(reloadedB?.messages || [], 0);
    assert.notStrictEqual(reloadedA?.metadata.id, reloadedB?.metadata.id);
  });

  it("clears a transient reader source when reopening a collection workspace", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const store = new ConversationStore(rootDir);
    const readerWorkspace = createCollectionWorkspaceIdentity({
      libraryID: 1,
      collectionKey: "COLL",
      label: "Collection",
      defaultSource: paper,
    });
    const libraryWorkspace = createCollectionWorkspaceIdentity({
      libraryID: 1,
      collectionKey: "COLL",
      label: "Collection",
    });

    const created =
      await store.getOrCreateLatestWorkspaceConversation(readerWorkspace);
    assert.equal(created.metadata.defaultSource?.paperKey, paper.paperKey);

    const reopened =
      await store.getOrCreateLatestWorkspaceConversation(libraryWorkspace);
    assert.equal(reopened.metadata.id, created.metadata.id);
    assert.isUndefined(reopened.metadata.defaultSource);
  });

  it("lists, activates, and archives sessions within one workspace", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const otherPaper = createPaper("1:BBB", "BBB", "Paper B");
    const workspace = createItemWorkspaceIdentity(paper);
    const otherWorkspace = createItemWorkspaceIdentity(otherPaper);
    const store = new ConversationStore(rootDir);

    let first = await store.createWorkspaceConversation(workspace);
    first = await store.addMessage(first.metadata, {
      role: "user",
      text: "First session question",
    });
    await waitForTimestampTick();
    const second = await store.createWorkspaceConversation(workspace);
    const other = await store.createWorkspaceConversation(otherWorkspace);

    let paperSessions = await store.listWorkspaceConversations(
      workspace.workspaceKey,
    );
    assert.deepEqual(
      paperSessions.map((conversation) => conversation.metadata.id),
      [second.metadata.id, first.metadata.id],
    );
    assert.strictEqual(first.metadata.label, "First session question");

    await waitForTimestampTick();
    const activated = await store.activateWorkspaceConversation(first.metadata);
    const latest = await store.getLatestWorkspaceConversation(
      workspace.workspaceKey,
    );
    assert.strictEqual(latest?.metadata.id, activated.metadata.id);

    await store.archiveWorkspaceConversation(activated.metadata);
    paperSessions = await store.listWorkspaceConversations(
      workspace.workspaceKey,
    );
    assert.deepEqual(
      paperSessions.map((conversation) => conversation.metadata.id),
      [second.metadata.id],
    );
    const archivedSessions = await store.listArchivedWorkspaceConversations(
      workspace.workspaceKey,
    );
    assert.deepEqual(
      archivedSessions.map((conversation) => conversation.metadata.id),
      [activated.metadata.id],
    );
    assert.isTrue(archivedSessions[0]?.metadata.archived);
    const restoredMetadata = await store.restoreWorkspaceConversation(
      archivedSessions[0]!.metadata,
    );
    assert.isUndefined(restoredMetadata.archived);
    paperSessions = await store.listWorkspaceConversations(
      workspace.workspaceKey,
    );
    assert.deepEqual(
      paperSessions.map((conversation) => conversation.metadata.id),
      [activated.metadata.id, second.metadata.id],
    );
    assert.isUndefined(paperSessions[0]?.metadata.archived);
    assert.deepEqual(
      await store.listArchivedWorkspaceConversations(workspace.workspaceKey),
      [],
    );
    const otherSessions = await store.listWorkspaceConversations(
      otherWorkspace.workspaceKey,
    );
    assert.deepEqual(
      otherSessions.map((conversation) => conversation.metadata.id),
      [other.metadata.id],
    );
    const otherArchivedSessions =
      await store.listArchivedWorkspaceConversations(
        otherWorkspace.workspaceKey,
      );
    assert.deepEqual(otherArchivedSessions, []);
  });

  it("persists assistant completion metadata and interrupted status", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    const conversation = await store.createWorkspaceConversation(workspace);

    await store.addMessage(conversation.metadata, {
      role: "assistant",
      text: "Partial answer",
      status: "interrupted",
      completedAt: "2026-06-13T07:30:00.000Z",
      codexThreadId: "thread-a",
      codexTurnId: "turn-a",
      model: "gpt-5.5",
      providerBrand: "codex",
      reasoningEffort: "medium",
      trace: [
        {
          id: "reasoning-a",
          type: "reasoning",
          kind: "summary",
          text: "Checked the evidence",
        },
        {
          id: "call-a",
          type: "tool",
          name: "paper_read",
          status: "completed",
          result: "Evidence",
        },
      ],
    });

    const reloaded = await new ConversationStore(
      rootDir,
    ).getLatestWorkspaceConversation(workspace.workspaceKey);
    assert.strictEqual(reloaded?.messages[0]?.status, "interrupted");
    assert.strictEqual(
      reloaded?.messages[0]?.completedAt,
      "2026-06-13T07:30:00.000Z",
    );
    assert.strictEqual(reloaded?.messages[0]?.model, "gpt-5.5");
    assert.strictEqual(reloaded?.messages[0]?.providerBrand, "codex");
    assert.strictEqual(reloaded?.messages[0]?.reasoningEffort, "medium");
    assert.deepEqual(
      reloaded?.messages[0]?.trace?.map((item) => item.type),
      ["reasoning", "tool"],
    );
  });

  it("persists structured source mentions on user messages", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    const conversation = await store.createWorkspaceConversation(workspace);

    await store.addMessage(conversation.metadata, {
      role: "user",
      text: "Compare @Paper A",
      mentions: [
        {
          id: "mention-a",
          sourceId: "1-AAA-pdf",
          paperKey: "1:AAA",
          libraryID: 1,
          parentItemID: 10,
          parentItemKey: "AAA",
          attachmentItemID: 11,
          attachmentKey: "AAA-pdf",
          title: "Paper A",
        },
      ],
    });

    const reloaded = await new ConversationStore(
      rootDir,
    ).getLatestWorkspaceConversation(workspace.workspaceKey);

    assert.deepEqual(
      reloaded?.messages[0]?.mentions?.map((item) => item.sourceId),
      ["1-AAA-pdf"],
    );
  });

  it("persists local attachment paths on user messages", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    const conversation = await store.createWorkspaceConversation(workspace);

    await store.addMessage(conversation.metadata, {
      role: "user",
      text: "Read this figure",
      localAttachments: [
        {
          id: "local-figure",
          path: "/tmp/figure.png",
          filename: "figure.png",
          kind: "image",
          mimeType: "image/png",
        },
      ],
    });

    const reloaded = await new ConversationStore(
      rootDir,
    ).getLatestWorkspaceConversation(workspace.workspaceKey);

    assert.deepEqual(reloaded?.messages[0]?.localAttachments, [
      {
        id: "local-figure",
        path: "/tmp/figure.png",
        filename: "figure.png",
        kind: "image",
        mimeType: "image/png",
      },
    ]);
  });

  it("keeps old messages without mentions valid", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    await store.createWorkspaceConversation(workspace);
    const { messagesPath } = await getConversationFilePaths(
      workspace.workspaceKey,
    );

    await writeFile(
      messagesPath,
      `${JSON.stringify({
        id: "msg-old",
        conversationId: "conv-old",
        role: "user",
        text: "Old question",
        createdAt: "2026-07-01T00:00:00.000Z",
        status: "complete",
      })}\n`,
      "utf8",
    );

    const reloaded = await store.getLatestWorkspaceConversation(
      workspace.workspaceKey,
    );

    assert.isUndefined(reloaded?.messages[0]?.mentions);
  });

  it("fails loudly on invalid conversation metadata", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    await store.createWorkspaceConversation(workspace);
    const { metadataPath } = await getConversationFilePaths(
      workspace.workspaceKey,
    );

    await writeFile(metadataPath, JSON.stringify({ id: "broken" }), "utf8");

    await assertRejects(
      () => store.getLatestWorkspaceConversation(workspace.workspaceKey),
      "Invalid Zopilot conversation metadata",
    );
  });

  it("fails loudly on invalid conversation messages", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const store = new ConversationStore(rootDir);
    const conversation = await store.createWorkspaceConversation(workspace);
    await store.addMessage(conversation.metadata, {
      role: "user",
      text: "Question",
    });
    const { messagesPath } = await getConversationFilePaths(
      workspace.workspaceKey,
    );

    await writeFile(messagesPath, JSON.stringify({ id: "broken" }), "utf8");

    await assertRejects(
      () => store.getLatestWorkspaceConversation(workspace.workspaceKey),
      "Invalid Zopilot conversation message",
    );
  });

  it("uses Zotero.Profile.dir for the default conversation root", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const workspace = createItemWorkspaceIdentity(paper);
    const profileDir = join(rootDir, "profile");
    let deprecatedProfileDirectoryCalled = false;
    installZoteroProfileMock(profileDir, () => {
      deprecatedProfileDirectoryCalled = true;
      throw new Error("Deprecated getProfileDirectory should not be called.");
    });
    const store = new ConversationStore();

    await store.createWorkspaceConversation(workspace);

    const workspaceDir = join(
      profileDir,
      "zopilot",
      "conversations",
      "workspaces",
      encodePathSegment(workspace.workspaceKey),
    );
    const files = await readdir(workspaceDir);
    assert.isFalse(deprecatedProfileDirectoryCalled);
    assert.lengthOf(
      files.filter((file) => file.endsWith(".json")),
      1,
    );
    assert.lengthOf(
      files.filter((file) => file.endsWith(".jsonl")),
      1,
    );
  });
});

function createPaper(
  paperKey: string,
  parentItemKey: string,
  title: string,
): PaperIdentity {
  return {
    paperKey,
    libraryID: 1,
    parentItemID: parentItemKey === "AAA" ? 10 : 20,
    parentItemKey,
    attachmentItemID: parentItemKey === "AAA" ? 11 : 21,
    attachmentKey: `${parentItemKey}-pdf`,
    title,
  };
}

async function waitForTimestampTick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 2));
}

async function getConversationFilePaths(workspaceKey: string): Promise<{
  metadataPath: string;
  messagesPath: string;
}> {
  const dir = join(rootDir, "workspaces", encodePathSegment(workspaceKey));
  const files = await readdir(dir);
  const metadataPath = files.find((file) => file.endsWith(".json"));
  const messagesPath = files.find((file) => file.endsWith(".jsonl"));
  if (!metadataPath || !messagesPath) {
    throw new Error("Conversation test fixture is incomplete.");
  }
  return {
    metadataPath: join(dir, metadataPath),
    messagesPath: join(dir, messagesPath),
  };
}

async function assertRejects(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert.include(String(error), expectedMessage);
    return;
  }
  assert.fail("Expected action to reject.");
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function installFileMocks(): void {
  (globalThis as typeof globalThis & { IOUtils: typeof IOUtils }).IOUtils = {
    exists: async (path) => existsSync(path),
    getChildren: async (path) =>
      (await readdir(path)).map((entry) => join(path, entry)),
    makeDirectory: async (path, options) => {
      await mkdir(path, { recursive: Boolean(options?.createAncestors) });
    },
    move: async (sourcePath, targetPath) => {
      await rename(sourcePath, targetPath);
    },
    readJSON: async (path) => JSON.parse(await readFile(path, "utf8")),
    readUTF8: async (path) => readFile(path, "utf8"),
    remove: async (path, options) => {
      await rm(path, { force: Boolean(options?.ignoreAbsent) });
    },
    writeUTF8: async (path, text) => {
      await writeFile(path, text, "utf8");
      return text.length;
    },
  } as typeof IOUtils;

  (
    globalThis as typeof globalThis & { PathUtils: typeof PathUtils }
  ).PathUtils = {
    join,
  } as typeof PathUtils;
}

function installZoteroProfileMock(
  profileDir: string,
  getProfileDirectory: () => never,
): void {
  (globalThis as unknown as { Zotero: unknown }).Zotero = {
    Profile: {
      dir: profileDir,
    },
    getProfileDirectory,
  };
}

function restoreZoteroMock(): void {
  if (originalZotero === undefined) {
    delete (globalThis as unknown as { Zotero?: unknown }).Zotero;
    return;
  }
  globalThis.Zotero = originalZotero;
}
