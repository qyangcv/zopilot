import { assert } from "chai";
import { parseConversationMetadata } from "../../../src/runtime/persistence/threads/LegacyConversationCodec.ts";
import { LegacyConversationReader } from "../../../src/runtime/persistence/threads/LegacyConversationReader.ts";

describe("legacy conversation metadata codec", function () {
  it("normalizes paper-scoped history into the matching item workspace", function () {
    const metadata = parseConversationMetadata({
      paperKey: "1:PAPER",
      libraryID: 1,
      parentItemID: 10,
      parentItemKey: "PAPER",
      attachmentItemID: 11,
      attachmentKey: "PDF",
      title: "Legacy paper",
      id: "legacy-paper-thread",
      scope: "paper",
      label: "Legacy question",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      codexThreadId: "codex-thread",
    });

    assert.deepInclude(metadata, {
      id: "legacy-paper-thread",
      scope: "workspace",
      workspaceKey: "item:1:PAPER",
      workspaceType: "item",
      workspaceLabel: "Legacy paper",
      itemKey: "PAPER",
      codexThreadId: "codex-thread",
    });
    assert.equal(metadata?.defaultSource?.attachmentKey, "PDF");
  });

  it("rejects incomplete paper-scoped metadata", function () {
    assert.isUndefined(
      parseConversationMetadata({
        scope: "paper",
        id: "incomplete",
      }),
    );
  });

  it("scans both workspace and paper legacy directories", async function () {
    const ioDescriptor = Object.getOwnPropertyDescriptor(globalThis, "IOUtils");
    const pathDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "PathUtils",
    );
    const directories: Record<string, string[]> = {
      "/legacy/workspaces": [
        "/legacy/workspaces/library%3A1",
        "/legacy/workspaces/.DS_Store",
      ],
      "/legacy/workspaces/library%3A1": [
        "/legacy/workspaces/library%3A1/workspace.json",
      ],
      "/legacy/papers": ["/legacy/papers/1%3APAPER"],
      "/legacy/papers/1%3APAPER": ["/legacy/papers/1%3APAPER/paper.json"],
    };
    const metadata: Record<string, unknown> = {
      "/legacy/workspaces/library%3A1/workspace.json": {
        id: "workspace-thread",
        scope: "workspace",
        workspaceKey: "library:1",
        workspaceType: "library",
        workspaceLabel: "Library",
        workspaceTitle: "Library",
        libraryID: 1,
        label: "Workspace history",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
      "/legacy/papers/1%3APAPER/paper.json": {
        paperKey: "1:PAPER",
        libraryID: 1,
        parentItemID: 10,
        parentItemKey: "PAPER",
        attachmentItemID: 11,
        attachmentKey: "PDF",
        title: "Legacy paper",
        id: "paper-thread",
        scope: "paper",
        label: "Paper history",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    };
    const message = JSON.stringify({
      id: "message",
      conversationId: "thread",
      role: "user",
      text: "Question",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "complete",
    });

    try {
      Object.defineProperty(globalThis, "PathUtils", {
        configurable: true,
        value: { join: (...parts: string[]) => parts.join("/") },
      });
      Object.defineProperty(globalThis, "IOUtils", {
        configurable: true,
        value: {
          exists: async (path: string) =>
            Object.hasOwn(directories, path) || Object.hasOwn(metadata, path),
          getChildren: async (path: string) => {
            const children = directories[path];
            if (!children) throw new Error(`Not a directory: ${path}`);
            return children;
          },
          readJSON: async (path: string) => metadata[path],
          readUTF8: async () => message,
        },
      });

      const entries = await new LegacyConversationReader("/legacy").readAll();
      assert.deepEqual(
        entries.map((entry) => [
          entry.status,
          entry.status === "ready" ? entry.conversation.metadata.id : entry.key,
        ]),
        [
          ["ready", "workspace-thread"],
          ["ready", "paper-thread"],
        ],
      );
    } finally {
      restoreGlobal("IOUtils", ioDescriptor);
      restoreGlobal("PathUtils", pathDescriptor);
    }
  });
});

function restoreGlobal(
  name: "IOUtils" | "PathUtils",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    delete (globalThis as unknown as Record<string, unknown>)[name];
  }
}
