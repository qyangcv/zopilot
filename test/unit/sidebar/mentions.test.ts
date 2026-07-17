import { assert } from "chai";
import {
  MAX_SOURCE_MENTIONS,
  findMentionQuery,
  matchItemContextNodes,
  matchMentionCandidates,
  moveMentionCandidateIndex,
  sourceToMention,
} from "../../../src/features/sidebar/ui/mentions.ts";
import type { PaperSourceRef } from "../../../src/domain/conversation.ts";

describe("sidebar source mentions", function () {
  it("allows up to ten selected sources per message", function () {
    assert.equal(MAX_SOURCE_MENTIONS, 10);
  });

  it("keeps spaces inside the active @ query", function () {
    const text = "compare @deep seek math with baseline";
    const query = findMentionQuery(text, "@deep seek math".length + 8);

    assert.deepEqual(query, {
      start: 8,
      end: 23,
      query: "deep seek math",
    });
  });

  it("stops @ queries at punctuation but not spaces", function () {
    assert.isNull(findMentionQuery("read @paper, next", 12));
    assert.equal(
      findMentionQuery("read @paper title", 17)?.query,
      "paper title",
    );
  });

  it("ranks exact, prefix, substring, and multi-token matches", function () {
    const sources = [
      createSource("s1", "A Survey of Retrieval Augmented Generation", "2024"),
      createSource(
        "s2",
        "DeepSeekMath: Pushing Mathematical Reasoning",
        "2025",
      ),
      createSource("s3", "Language Models for Search", "2023"),
    ];

    assert.equal(
      matchMentionCandidates("deep seek math", sources)[0]?.sourceId,
      "s2",
    );
    assert.equal(matchMentionCandidates("survey", sources)[0]?.sourceId, "s1");
    assert.equal(
      matchMentionCandidates("models search", sources)[0]?.sourceId,
      "s3",
    );
  });

  it("returns all workspace sources for an empty @ query", function () {
    const sources = Array.from({ length: 12 }, (_, index) =>
      createSource(
        `s${index}`,
        `Paper ${String(index).padStart(2, "0")}`,
        "2026",
      ),
    );

    assert.lengthOf(matchMentionCandidates("", sources), 12);
  });

  it("does not cap matching @ candidates at eight results", function () {
    const sources = Array.from({ length: 12 }, (_, index) =>
      createSource(
        `s${index}`,
        `Retrieval Augmented Generation Study ${index}`,
        "2026",
      ),
    );

    assert.lengthOf(matchMentionCandidates("retrieval", sources), 12);
  });

  it("wraps keyboard navigation across mention candidates", function () {
    assert.equal(moveMentionCandidateIndex(0, 3, 1), 1);
    assert.equal(moveMentionCandidateIndex(2, 3, 1), 0);
    assert.equal(moveMentionCandidateIndex(0, 3, -1), 2);
    assert.equal(moveMentionCandidateIndex(9, 3, -1), 1);
    assert.equal(moveMentionCandidateIndex(0, 0, 1), 0);
  });

  it("filters item context trees by attachment and note titles", function () {
    const nodes = [
      {
        id: "1-PDF",
        kind: "pdf" as const,
        title: "Main Paper.pdf",
        current: true,
        selectable: true,
        source: createSource("1-PDF", "Main Paper.pdf", "2026"),
      },
      {
        id: "note:1:NOTE",
        kind: "note" as const,
        title: "Experiment ideas",
        selectable: true as const,
        note: {
          id: "note:1:NOTE",
          libraryID: 1,
          parentItemID: 10,
          parentItemKey: "PAPER",
          noteItemID: 12,
          noteItemKey: "NOTE",
          title: "Experiment ideas",
          dateModified: "2026-07-17 10:00:00",
        },
      },
    ];

    assert.deepEqual(
      matchItemContextNodes("experiment", nodes).map((node) => node.id),
      ["note:1:NOTE"],
    );
    assert.lengthOf(matchItemContextNodes("", nodes), 2);
  });

  it("converts selected sources to stable mention payloads", function () {
    const mention = sourceToMention(createSource("s1", "Paper A", "2024"));

    assert.equal(mention.sourceId, "s1");
    assert.equal(mention.title, "Paper A");
    assert.equal(mention.attachmentKey, "PDF-s1");
  });
});

function createSource(
  sourceId: string,
  title: string,
  year: string,
): PaperSourceRef {
  return {
    sourceId,
    paperKey: `1:${sourceId}`,
    libraryID: 1,
    parentItemID: 10,
    parentItemKey: sourceId,
    attachmentItemID: 11,
    attachmentKey: `PDF-${sourceId}`,
    title,
    year,
    creators: ["Ada Lovelace"],
  };
}
