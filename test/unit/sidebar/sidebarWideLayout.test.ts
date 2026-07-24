import { assert } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("sidebar wide layout styles", function () {
  it("centers message rows within a 900px reading column", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-messages.css"),
      "utf8",
    );

    assert.match(
      css,
      /\.zp-message\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*900px;[\s\S]*margin-inline:\s*auto;/u,
    );
  });

  it("keeps the composer gutter while capping its content at 900px", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-composer.css"),
      "utf8",
    );

    assert.include(css, "max(");
    assert.include(css, "var(--zp-sidebar-gutter, 14px)");
    assert.include(css, "calc((100% - 900px) / 2)");
  });
});
