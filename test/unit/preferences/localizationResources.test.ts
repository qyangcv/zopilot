import { assert } from "chai";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "@fluent/syntax";
import {
  formatLocalizedMessage,
  localized,
} from "../../../src/features/preferences/localization.ts";

describe("preference localization resources", function () {
  let english: Map<string, string[]>;
  let chinese: Map<string, string[]>;
  let addonEnglish: Map<string, string[]>;
  let addonChinese: Map<string, string[]>;

  before(function () {
    english = readMessages("addon/locale/en-US/preferences.ftl");
    chinese = readMessages("addon/locale/zh-CN/preferences.ftl");
    addonEnglish = readMessages("addon/locale/en-US/addon.ftl");
    addonChinese = readMessages("addon/locale/zh-CN/addon.ftl");
  });

  it("keeps add-on locale message ids and attributes in sync", function () {
    assert.deepEqual(
      [...addonChinese.keys()].sort(),
      [...addonEnglish.keys()].sort(),
    );
    for (const [id, attributes] of addonEnglish) {
      assert.deepEqual(
        addonChinese.get(id),
        attributes,
        `localized attributes differ for ${id}`,
      );
    }
  });

  it("keeps locale message ids and attributes in sync", function () {
    assert.deepEqual([...chinese.keys()].sort(), [...english.keys()].sort());
    for (const [id, attributes] of english) {
      assert.deepEqual(
        chinese.get(id),
        attributes,
        `localized attributes differ for ${id}`,
      );
    }
  });

  it("defines every preference localization id referenced by the UI", function () {
    const referenced = collectReferencedMessageIds(
      resolve("src/features/preferences"),
    );
    const missing = [...referenced].filter((id) => !english.has(id));

    assert.deepEqual(missing, []);
  });

  it("defines every sidebar localization id referenced by the UI", function () {
    const referenced = collectReferencedMessageIds(
      resolve("src/features/sidebar"),
      "sidebar",
    );
    const missing = [...referenced].filter((id) => !addonEnglish.has(id));

    assert.deepEqual(missing, []);
  });

  it("formats imperative messages through the same Fluent document", async function () {
    const host = globalThis as typeof globalThis & {
      document?: {
        l10n: {
          formatValue: (
            id: string,
            args?: Record<string, string | number>,
          ) => Promise<string>;
        };
      };
    };
    const originalDocument = host.document;
    let formattedId = "";
    host.document = {
      l10n: {
        async formatValue(id) {
          formattedId = id;
          return "Discard unsaved changes and return to the prompt list?";
        },
      },
    };
    try {
      assert.equal(
        await formatLocalizedMessage(
          localized("pref-prompt-confirm-discard-changes"),
        ),
        "Discard unsaved changes and return to the prompt list?",
      );
      assert.equal(formattedId, "zopilot-pref-prompt-confirm-discard-changes");
    } finally {
      if (originalDocument) {
        host.document = originalDocument;
      } else {
        delete host.document;
      }
    }
  });
});

function readMessages(file: string): Map<string, string[]> {
  const resource = parse(readFileSync(resolve(file), "utf8"), {
    withSpans: true,
  });
  const junk = resource.body.filter((entry) => entry.type === "Junk");
  assert.lengthOf(junk, 0, `${file} contains invalid Fluent syntax`);
  return new Map(
    resource.body.flatMap(
      (entry): Array<[string, string[]]> =>
        entry.type === "Message"
          ? [
              [
                entry.id.name,
                entry.attributes.map((item) => item.id.name).sort(),
              ],
            ]
          : [],
    ),
  );
}

function collectReferencedMessageIds(
  root: string,
  prefix = "pref",
): Set<string> {
  const ids = new Set<string>();
  const pattern = new RegExp(`["'](${prefix}-[a-z0-9-]+)["']`, "gu");
  for (const file of listSourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function listSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(path);
    }
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}
