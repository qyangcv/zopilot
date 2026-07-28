import { assert } from "chai";
import {
  createChunkLocator,
  createDocumentLocator,
  createMaterialRevision,
  createSectionLocator,
  matchesMaterialRevision,
  parseLocator,
} from "../../../src/document/locator.ts";

const PDF_HASH = "ab".repeat(32);

describe("paper locator codec", function () {
  it("round-trips document, section, and chunk locators", function () {
    const revision = createMaterialRevision(PDF_HASH);
    assert.deepEqual(parseLocator(createDocumentLocator("1-PDF", PDF_HASH)), {
      sourceId: "1-PDF",
      revision,
      kind: "document",
    });
    assert.deepEqual(
      parseLocator(createSectionLocator("1-PDF", PDF_HASH, "section-0001")),
      {
        sourceId: "1-PDF",
        revision,
        kind: "section",
        id: "section-0001",
      },
    );
    assert.deepEqual(
      parseLocator(createChunkLocator("1-PDF", PDF_HASH, "chunk-000001")),
      {
        sourceId: "1-PDF",
        revision,
        kind: "chunk",
        id: "chunk-000001",
      },
    );
  });

  it("uses explicit target names without exposing a development version", function () {
    assert.match(
      createDocumentLocator("1-PDF", PDF_HASH),
      /^doc\.1-PDF\.[A-Za-z0-9_-]{16}$/u,
    );
    assert.match(
      createSectionLocator("1-PDF", PDF_HASH, "section-0003"),
      /^section\.1-PDF\.[A-Za-z0-9_-]{16}\.3$/u,
    );
    assert.match(
      createChunkLocator("1-PDF", PDF_HASH, "chunk-000036"),
      /^chunk\.1-PDF\.[A-Za-z0-9_-]{16}\.10$/u,
    );
  });

  it("rejects malformed, legacy, and non-canonical locators", function () {
    assert.throws(() => parseLocator("section-1"), /Invalid/);
    assert.throws(
      () => parseLocator("zpl1.s.MS1QREY.hYWJj.c2VjdGlvbi0x"),
      /Invalid/,
    );
    assert.throws(
      () => createSectionLocator("1.PDF", PDF_HASH, "section-0001"),
      /Invalid/,
    );
    assert.throws(
      () => createSectionLocator("1-PDF", PDF_HASH, "section-introduction"),
      /Invalid/,
    );
  });

  it("uses a compact material revision for stale detection", function () {
    const revision = createMaterialRevision(PDF_HASH);
    const locator = createSectionLocator(
      "1-L99LJGGC",
      PDF_HASH,
      "section-0002",
    );

    assert.lengthOf(revision, 16);
    assert.isBelow(locator.length, 40);
    assert.isTrue(matchesMaterialRevision(revision, PDF_HASH));
    assert.isFalse(matchesMaterialRevision(revision, "cd".repeat(32)));
  });
});
