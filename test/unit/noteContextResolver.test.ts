import { assert } from "chai";
import { createItemWorkspaceIdentity } from "../../src/domain/conversation.ts";
import {
  ZoteroNoteContextResolver,
  noteHtmlToText,
} from "../../src/integrations/zotero/ZoteroNoteContextResolver.ts";

describe("ZoteroNoteContextResolver", function () {
  it("keeps all visible note text while removing scripts and embedded images", function () {
    const text = noteHtmlToText(
      [
        "<h1>Method &amp; Results</h1>",
        '<p>Read <a href="https://example.com?a=1&amp;b=2">the source</a>.</p>',
        "<ul><li>First</li><li>Second</li></ul>",
        '<img src="data:image/png;base64,abc" alt="hidden">',
        "<script>ignore me</script>",
      ].join(""),
    );

    assert.include(text, "# Method & Results");
    assert.include(text, "the source (https://example.com?a=1&b=2)");
    assert.include(text, "- First");
    assert.include(text, "- Second");
    assert.notInclude(text, "base64");
    assert.notInclude(text, "ignore me");
  });

  it("reads the latest full note body on every send without truncation", async function () {
    let body = `<p>${"a".repeat(20_000)}</p>`;
    const note = createNote(() => body);
    const resolver = new ZoteroNoteContextResolver(createZoteroMock(note));

    const first = await resolver.resolveAll(createWorkspace(), [createRef()]);
    body = "<p>updated body</p>";
    const second = await resolver.resolveAll(createWorkspace(), [createRef()]);

    assert.lengthOf(first[0]?.content || "", 20_000);
    assert.equal(second[0]?.content, "updated body");
  });

  it("rejects a note that no longer belongs to the current item", async function () {
    const note = {
      ...createNote(() => "<p>moved</p>"),
      parentItemKey: "OTHER",
    };
    const resolver = new ZoteroNoteContextResolver(createZoteroMock(note));

    try {
      await resolver.resolveAll(createWorkspace(), [createRef()]);
      assert.fail("Expected moved note to be rejected");
    } catch (error) {
      assert.include(String(error), "no longer belongs");
    }
  });

  it("resolves a selected item note in a library workspace", async function () {
    const note = createNote(() => "<p>library note</p>");
    const resolver = new ZoteroNoteContextResolver(createZoteroMock(note));

    const result = await resolver.resolveAll(
      {
        workspaceKey: "library:1",
        workspaceType: "library",
        libraryID: 1,
        workspaceLabel: "My Library",
        workspaceTitle: "My Library",
      },
      [createRef()],
      [createMention()],
    );

    assert.equal(result[0]?.content, "library note");
  });

  it("resolves an explicitly selected child note without a paper mention", async function () {
    const note = createNote(() => "<p>explicit child note</p>");
    const resolver = new ZoteroNoteContextResolver(createZoteroMock(note));

    const result = await resolver.resolveAll(
      {
        workspaceKey: "library:1",
        workspaceType: "library",
        libraryID: 1,
        workspaceLabel: "My Library",
        workspaceTitle: "My Library",
      },
      [createRef()],
    );

    assert.equal(result[0]?.content, "explicit child note");
  });

  it("resolves notes only when the selected item belongs to the collection", async function () {
    const note = createNote(() => "<p>collection note</p>");
    const resolver = new ZoteroNoteContextResolver(
      createZoteroMock(note, true),
    );
    const workspace = {
      workspaceKey: "collection:1:COLL",
      workspaceType: "collection" as const,
      libraryID: 1,
      workspaceLabel: "Reading",
      workspaceTitle: "Reading",
      collectionKey: "COLL",
    };

    const result = await resolver.resolveAll(workspace, [createRef()]);
    assert.equal(result[0]?.content, "collection note");

    const outsideResolver = new ZoteroNoteContextResolver(
      createZoteroMock(note, false),
    );
    try {
      await outsideResolver.resolveAll(
        workspace,
        [createRef()],
        [createMention()],
      );
      assert.fail("Expected an item outside the collection to be rejected");
    } catch (error) {
      assert.include(String(error), "outside the current workspace");
    }
  });

  it("rejects a library note whose parent item was deleted", async function () {
    const note = createNote(() => "<p>orphaned</p>");
    const resolver = new ZoteroNoteContextResolver(
      createZoteroMock(note, false, true),
    );

    try {
      await resolver.resolveAll(
        {
          workspaceKey: "library:1",
          workspaceType: "library",
          libraryID: 1,
          workspaceLabel: "My Library",
          workspaceTitle: "My Library",
        },
        [createRef()],
        [createMention()],
      );
      assert.fail("Expected a deleted parent item to be rejected");
    } catch (error) {
      assert.include(String(error), "parent is no longer available");
    }
  });

  it("resolves top-level notes in library and collection workspaces", async function () {
    const note = createTopLevelNote(() => "<p>top-level note</p>");
    const resolver = new ZoteroNoteContextResolver(
      createTopLevelZoteroMock(note, true),
    );
    const reference = createTopLevelRef();

    const libraryResult = await resolver.resolveAll(
      {
        workspaceKey: "library:1",
        workspaceType: "library",
        libraryID: 1,
        workspaceLabel: "My Library",
        workspaceTitle: "My Library",
      },
      [reference],
    );
    const collectionResult = await resolver.resolveAll(
      {
        workspaceKey: "collection:1:COLL",
        workspaceType: "collection",
        libraryID: 1,
        workspaceLabel: "Reading",
        workspaceTitle: "Reading",
        collectionKey: "COLL",
      },
      [reference],
    );

    assert.equal(libraryResult[0]?.content, "top-level note");
    assert.equal(collectionResult[0]?.content, "top-level note");
  });

  it("rejects top-level notes outside the current collection or in an item workspace", async function () {
    const note = createTopLevelNote(() => "<p>top-level note</p>");
    const reference = createTopLevelRef();
    const outsideResolver = new ZoteroNoteContextResolver(
      createTopLevelZoteroMock(note, false),
    );
    const itemResolver = new ZoteroNoteContextResolver(
      createTopLevelZoteroMock(note, true),
    );

    for (const [resolver, workspace] of [
      [
        outsideResolver,
        {
          workspaceKey: "collection:1:COLL",
          workspaceType: "collection" as const,
          libraryID: 1,
          workspaceLabel: "Reading",
          workspaceTitle: "Reading",
          collectionKey: "COLL",
        },
      ],
      [itemResolver, createWorkspace()],
    ] as const) {
      try {
        await resolver.resolveAll(workspace, [reference]);
        assert.fail("Expected the top-level note to be rejected");
      } catch (error) {
        assert.include(String(error), "outside the current workspace");
      }
    }
  });
});

function createWorkspace() {
  return createItemWorkspaceIdentity({
    paperKey: "1:PAPER",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    attachmentItemID: 11,
    attachmentKey: "PDF",
    title: "Paper",
  });
}

function createRef() {
  return {
    id: "note:1:NOTE",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    noteItemID: 21,
    noteItemKey: "NOTE",
    title: "Reading notes",
    dateModified: "2026-07-17 10:00:00",
  };
}

function createMention() {
  return {
    id: "mention:1:PDF",
    sourceId: "1-PDF",
    paperKey: "1:PAPER",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    attachmentItemID: 11,
    attachmentKey: "PDF",
    title: "Paper",
  };
}

function createTopLevelRef() {
  return {
    id: "note:1:TOP",
    libraryID: 1,
    noteItemID: 31,
    noteItemKey: "TOP",
    title: "Top-level note",
    dateModified: "2026-07-18 10:00:00",
  };
}

function createNote(getBody: () => string) {
  return {
    id: 21,
    key: "NOTE",
    libraryID: 1,
    parentItemID: 1,
    parentItemKey: "PAPER",
    getNote: getBody,
    isNote: () => true,
  };
}

function createTopLevelNote(getBody: () => string) {
  return {
    id: 31,
    key: "TOP",
    libraryID: 1,
    parentItemID: false,
    parentItemKey: false,
    getNote: getBody,
    isNote: () => true,
  };
}

function createZoteroMock(
  note: ReturnType<typeof createNote>,
  includeParentInCollection = false,
  parentDeleted = false,
): typeof Zotero {
  const parent = {
    id: 1,
    key: "PAPER",
    libraryID: 1,
    deleted: parentDeleted,
    isRegularItem: () => true,
  };
  return {
    Items: {
      getAsync: async (id: number) =>
        id === note.id ? note : id === parent.id ? parent : undefined,
      getByLibraryAndKeyAsync: async (libraryID: number, key: string) =>
        libraryID === parent.libraryID && key === parent.key ? parent : false,
    },
    Collections: {
      getByLibrary() {
        return [
          {
            id: 31,
            key: "COLL",
            libraryID: 1,
            name: "Reading",
            getChildItems() {
              return includeParentInCollection ? [parent] : [];
            },
            getChildCollections() {
              return [];
            },
          },
        ];
      },
    },
  } as unknown as typeof Zotero;
}

function createTopLevelZoteroMock(
  note: ReturnType<typeof createTopLevelNote>,
  includeInCollection: boolean,
): typeof Zotero {
  return {
    Items: {
      getAsync: async (id: number) => (id === note.id ? note : undefined),
      getByLibraryAndKeyAsync: async () => false,
    },
    Collections: {
      getByLibrary() {
        return [
          {
            id: 31,
            key: "COLL",
            libraryID: 1,
            name: "Reading",
            getChildItems() {
              return includeInCollection ? [note] : [];
            },
            getChildCollections() {
              return [];
            },
          },
        ];
      },
    },
  } as unknown as typeof Zotero;
}
