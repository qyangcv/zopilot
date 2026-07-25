import { assert } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chat window layout styles", function () {
  it("defines one shared 900px content width token", function () {
    const hostCss = readFileSync(
      resolve("addon/content/styles/context-pane.css"),
      "utf8",
    );
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-messages.css"),
      "utf8",
    );

    assert.include(hostCss, "--zp-chat-content-max-width: 900px");
    assert.include(css, "max-width: var(--zp-chat-content-max-width, 900px)");
    assert.include(css, "margin-inline: auto");
  });

  it("keeps the composer gutter while capping its content at 900px", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-composer.css"),
      "utf8",
    );

    assert.include(css, "max(");
    assert.include(css, "var(--zp-sidebar-gutter, 14px)");
    assert.include(css, "var(--zp-chat-content-max-width, 900px)");
  });

  it("gives the plugin-owned window a full-size isolated host", function () {
    const css = readFileSync(
      resolve("addon/content/styles/detached-chat-window.css"),
      "utf8",
    );
    const xhtml = readFileSync(
      resolve("addon/content/detached-chat-window.xhtml"),
      "utf8",
    );

    assert.include(css, "#zopilot-detached-window-host");
    assert.include(css, "width: 100%");
    assert.include(css, "height: 100%");
    assert.include(xhtml, 'id="zopilot-detached-window-host"');
    assert.include(xhtml, 'windowtype="zopilot:detached-chat"');
  });

  it("rotates the restore-to-sidebar icon counterclockwise", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );

    assert.include(css, ".zp-restore-sidebar-icon");
    assert.include(css, "transform: rotate(-180deg)");
  });

  it("reserves a fixed navigation column in the detached presentation", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );

    assert.include(css, "--zp-detached-navigation-width: 232px");
    assert.include(css, ".zp-detached-navigation");
    assert.include(
      css,
      "inset-inline-start: var(--zp-detached-navigation-width)",
    );
    assert.include(css, ".zp-detached-session-list");
    assert.include(css, "overflow-y: auto");
  });

  it("removes the detached header and aligns lightweight navigation controls", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );
    const detachedCss = readFileSync(
      resolve("addon/content/styles/detached-chat-window.css"),
      "utf8",
    );

    assert.include(css, "--zp-header-height: 0px");
    assert.include(css, ".zp-detached-restore-button");
    assert.include(css, "inset-block-start: 10px");
    assert.include(css, "background: transparent !important");
    assert.include(css, "box-shadow: none");
    assert.notInclude(detachedCss, ".zp-sidebar-header");
    assert.include(css, ".zp-detached-new-session,");
    assert.include(css, ".zp-detached-session-toggle {");
    assert.include(css, "font-size: 11.5px");
    assert.include(css, "font-weight: 400");
    assert.include(css, "CanvasText 7%");
    assert.include(css, "CanvasText 10%");
    assert.include(css, ".zp-detached-navigation-disclosure-spacer");
    assert.include(css, "padding-block-start: 3px");
    assert.include(css, "var(--zp-accent) 10%");
  });

  it("defines a portal tooltip that cannot intercept pointer input", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );
    const source = readFileSync(
      resolve("src/features/sidebar/ui/DetachedWindowTooltipLayer.tsx"),
      "utf8",
    );

    assert.include(css, ".zp-window-tooltip");
    assert.include(css, "pointer-events: none !important");
    assert.include(source, 'role="tooltip"');
    assert.include(source, 'doc.addEventListener("mouseover"');
    assert.include(source, "TOOLTIP_DELAY_MS = 450");
  });
});
