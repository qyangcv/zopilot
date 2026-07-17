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

function createZoteroMock(note: ReturnType<typeof createNote>): typeof Zotero {
  return {
    Items: {
      getAsync: async (id: number) => (id === note.id ? note : undefined),
    },
  } as unknown as typeof Zotero;
}
