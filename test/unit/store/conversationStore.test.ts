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
import { ConversationStore } from "../../../src/store/conversationStore.ts";
import type { PaperIdentity } from "../../../src/shared/conversation.ts";

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

  it("persists paper messages and keeps paper histories isolated", async function () {
    const paperA = createPaper("1:AAA", "AAA", "Paper A");
    const paperB = createPaper("1:BBB", "BBB", "Paper B");
    const store = new ConversationStore(rootDir);

    let conversationA = await store.getOrCreateLatestPaperConversation(paperA);
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
      await store.getOrCreateLatestPaperConversation(paperB);
    const reloadedStore = new ConversationStore(rootDir);
    const reloadedA = await reloadedStore.getLatestPaperConversation(
      paperA.paperKey,
    );
    const reloadedB = await reloadedStore.getLatestPaperConversation(
      paperB.paperKey,
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

  it("lists, activates, and archives sessions within one paper", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const otherPaper = createPaper("1:BBB", "BBB", "Paper B");
    const store = new ConversationStore(rootDir);

    let first = await store.createPaperConversation(paper);
    first = await store.addMessage(first.metadata, {
      role: "user",
      text: "First session question",
    });
    await waitForTimestampTick();
    const second = await store.createPaperConversation(paper);
    const other = await store.createPaperConversation(otherPaper);

    let paperSessions = await store.listPaperConversations(paper.paperKey);
    assert.deepEqual(
      paperSessions.map((conversation) => conversation.metadata.id),
      [second.metadata.id, first.metadata.id],
    );
    assert.strictEqual(first.metadata.label, "First session question");

    await waitForTimestampTick();
    const activated = await store.activatePaperConversation(first.metadata);
    const latest = await store.getLatestPaperConversation(paper.paperKey);
    assert.strictEqual(latest?.metadata.id, activated.metadata.id);

    await store.archivePaperConversation(activated.metadata);
    paperSessions = await store.listPaperConversations(paper.paperKey);
    assert.deepEqual(
      paperSessions.map((conversation) => conversation.metadata.id),
      [second.metadata.id],
    );
    const archivedSessions = await store.listArchivedPaperConversations(
      paper.paperKey,
    );
    assert.deepEqual(
      archivedSessions.map((conversation) => conversation.metadata.id),
      [activated.metadata.id],
    );
    assert.isTrue(archivedSessions[0]?.metadata.archived);
    const otherSessions = await store.listPaperConversations(
      otherPaper.paperKey,
    );
    assert.deepEqual(
      otherSessions.map((conversation) => conversation.metadata.id),
      [other.metadata.id],
    );
    const otherArchivedSessions = await store.listArchivedPaperConversations(
      otherPaper.paperKey,
    );
    assert.deepEqual(otherArchivedSessions, []);
  });

  it("persists assistant completion metadata and interrupted status", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const store = new ConversationStore(rootDir);
    const conversation = await store.createPaperConversation(paper);

    await store.addMessage(conversation.metadata, {
      role: "assistant",
      text: "Partial answer",
      status: "interrupted",
      completedAt: "2026-06-13T07:30:00.000Z",
      codexThreadId: "thread-a",
      codexTurnId: "turn-a",
      model: "gpt-5.5",
      reasoningEffort: "medium",
    });

    const reloaded = await new ConversationStore(
      rootDir,
    ).getLatestPaperConversation(paper.paperKey);
    assert.strictEqual(reloaded?.messages[0]?.status, "interrupted");
    assert.strictEqual(
      reloaded?.messages[0]?.completedAt,
      "2026-06-13T07:30:00.000Z",
    );
    assert.strictEqual(reloaded?.messages[0]?.model, "gpt-5.5");
    assert.strictEqual(reloaded?.messages[0]?.reasoningEffort, "medium");
  });

  it("fails loudly on invalid conversation metadata", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const store = new ConversationStore(rootDir);
    await store.createPaperConversation(paper);
    const { metadataPath } = await getConversationFilePaths(paper.paperKey);

    await writeFile(metadataPath, JSON.stringify({ id: "broken" }), "utf8");

    await assertRejects(
      () => store.getLatestPaperConversation(paper.paperKey),
      "Invalid Zopilot conversation metadata",
    );
  });

  it("fails loudly on invalid conversation messages", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const store = new ConversationStore(rootDir);
    const conversation = await store.createPaperConversation(paper);
    await store.addMessage(conversation.metadata, {
      role: "user",
      text: "Question",
    });
    const { messagesPath } = await getConversationFilePaths(paper.paperKey);

    await writeFile(messagesPath, JSON.stringify({ id: "broken" }), "utf8");

    await assertRejects(
      () => store.getLatestPaperConversation(paper.paperKey),
      "Invalid Zopilot conversation message",
    );
  });

  it("uses Zotero.Profile.dir for the default conversation root", async function () {
    const paper = createPaper("1:AAA", "AAA", "Paper A");
    const profileDir = join(rootDir, "profile");
    let deprecatedProfileDirectoryCalled = false;
    installZoteroProfileMock(profileDir, () => {
      deprecatedProfileDirectoryCalled = true;
      throw new Error("Deprecated getProfileDirectory should not be called.");
    });
    const store = new ConversationStore();

    await store.createPaperConversation(paper);

    const paperDir = join(
      profileDir,
      "zopilot",
      "conversations",
      "papers",
      encodePathSegment(paper.paperKey),
    );
    const files = await readdir(paperDir);
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

async function getConversationFilePaths(paperKey: string): Promise<{
  metadataPath: string;
  messagesPath: string;
}> {
  const dir = join(rootDir, "papers", encodePathSegment(paperKey));
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
