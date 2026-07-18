import { assert } from "chai";
import type {
  LocalAttachmentRef,
  NoteContextRef,
  PaperSourceRef,
  SourceMention,
} from "../../../src/domain/conversation.ts";
import {
  mergeDroppedContext,
  removeMentionFromComposerContext,
} from "../../../src/features/sidebar/ui/droppedContext.ts";

describe("mergeDroppedContext", function () {
  it("partially accepts sources and notes up to their shared limit", function () {
    const mentions = Array.from({ length: 9 }, (_, index) =>
      createMention(`EXISTING-${index}`),
    );

    const result = mergeDroppedContext(
      {
        mentions,
        noteContexts: [],
        localAttachments: [],
      },
      [
        { kind: "source", source: createSource("EXISTING-0") },
        { kind: "source", source: createSource("NEW") },
        { kind: "note", note: createNote("NOTE-SKIPPED") },
      ],
    );

    assert.lengthOf(result.mentions, 10);
    assert.equal(result.mentions.at(-1)?.sourceId, "1-NEW");
    assert.deepEqual(result.noteContexts, []);
  });

  it("applies a separate local attachment limit and ignores duplicate paths", function () {
    const localAttachments = Array.from({ length: 9 }, (_, index) =>
      createAttachment(`/tmp/existing-${index}.pdf`),
    );

    const result = mergeDroppedContext(
      {
        mentions: Array.from({ length: 10 }, (_, index) =>
          createMention(`SOURCE-${index}`),
        ),
        noteContexts: [],
        localAttachments,
      },
      [
        {
          kind: "local-attachment",
          attachment: createAttachment("/tmp/existing-0.pdf"),
        },
        {
          kind: "local-attachment",
          attachment: createAttachment("/tmp/new.pdf"),
        },
        {
          kind: "local-attachment",
          attachment: createAttachment("/tmp/skipped.pdf"),
        },
        { kind: "note", note: createNote("NOTE-SKIPPED") },
      ],
    );

    assert.lengthOf(result.localAttachments, 10);
    assert.equal(result.localAttachments.at(-1)?.path, "/tmp/new.pdf");
    assert.deepEqual(result.noteContexts, []);
  });

  it("keeps top-level notes as ordinary independent selections", function () {
    const note = createNote("TOP");
    delete note.parentItemKey;
    delete note.parentItemID;

    const result = mergeDroppedContext(
      { mentions: [], noteContexts: [], localAttachments: [] },
      [{ kind: "note", note }],
    );

    assert.deepEqual(result.noteContexts, [note]);
  });

  it("keeps a same-item PDF and note in either drop order", function () {
    const source = {
      ...createSource("PDF"),
      paperKey: "1:PAPER",
      parentItemKey: "PAPER",
    };
    const note = createNote("NOTE");
    const empty = { mentions: [], noteContexts: [], localAttachments: [] };

    const pdfThenNote = mergeDroppedContext(
      mergeDroppedContext(empty, [{ kind: "source", source }]),
      [{ kind: "note", note }],
    );
    const noteThenPdf = mergeDroppedContext(
      mergeDroppedContext(empty, [{ kind: "note", note }]),
      [{ kind: "source", source }],
    );

    for (const result of [pdfThenNote, noteThenPdf]) {
      assert.deepEqual(
        result.mentions.map((mention) => mention.sourceId),
        [source.sourceId],
      );
      assert.deepEqual(
        result.noteContexts.map((context) => context.id),
        [note.id],
      );
    }
  });

  it("removes only the selected PDF and preserves same-item context", function () {
    const target = {
      ...createMention("PDF"),
      paperKey: "1:PAPER",
      parentItemKey: "PAPER",
    };
    const sibling = {
      ...createMention("SUPPLEMENT"),
      paperKey: "1:PAPER",
      parentItemKey: "PAPER",
    };
    const note = createNote("NOTE");
    const localAttachment = createAttachment("/tmp/local.pdf");

    const result = removeMentionFromComposerContext(
      {
        mentions: [target, sibling],
        noteContexts: [note],
        localAttachments: [localAttachment],
      },
      target.id,
    );

    assert.deepEqual(result.mentions, [sibling]);
    assert.deepEqual(result.noteContexts, [note]);
    assert.deepEqual(result.localAttachments, [localAttachment]);
  });
});

function createSource(key: string): PaperSourceRef {
  return {
    sourceId: `1-${key}`,
    paperKey: `1:${key}`,
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: key,
    attachmentItemID: 11,
    attachmentKey: key,
    title: key,
  };
}

function createMention(key: string): SourceMention {
  return {
    id: `mention-${key}`,
    ...createSource(key),
  };
}

function createNote(key: string): NoteContextRef {
  return {
    id: `note:1:${key}`,
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: "PAPER",
    noteItemID: 20,
    noteItemKey: key,
    title: key,
    dateModified: "",
  };
}

function createAttachment(path: string): LocalAttachmentRef {
  return {
    id: `local-${path}`,
    path,
    filename: path.split("/").at(-1) || path,
    kind: "pdf",
    mimeType: "application/pdf",
  };
}
