import { assert } from "chai";
import { copyText } from "../../../src/features/sidebar/ui/clipboard.ts";

describe("sidebar clipboard", function () {
  afterEach(function () {
    delete (
      globalThis as typeof globalThis & {
        Components?: unknown;
      }
    ).Components;
  });

  it("uses the Gecko clipboard helper so each copy replaces the global clipboard text", async function () {
    const copied: string[] = [];
    (
      globalThis as typeof globalThis & {
        Components: unknown;
      }
    ).Components = {
      classes: {
        "@mozilla.org/widget/clipboardhelper;1": {
          getService() {
            return {
              copyString(value: string) {
                copied.push(value);
              },
            };
          },
        },
      },
      interfaces: {
        nsIClipboardHelper: {},
      },
    };

    await copyText("first copied text");
    await copyText("second copied text");

    assert.deepEqual(copied, ["first copied text", "second copied text"]);
    assert.strictEqual(copied.at(-1), "second copied text");
  });

  it("uses the Zotero window clipboard helper when the sandbox global only has window", async function () {
    const copied: string[] = [];
    const win = {
      Components: createComponentsMock(copied),
    } as unknown as Window;

    await copyText("window clipboard text", win);

    assert.deepEqual(copied, ["window clipboard text"]);
  });
});

function createComponentsMock(copied: string[]): unknown {
  return {
    classes: {
      "@mozilla.org/widget/clipboardhelper;1": {
        getService() {
          return {
            copyString(value: string) {
              copied.push(value);
            },
          };
        },
      },
    },
    interfaces: {
      nsIClipboardHelper: {},
    },
  };
}
