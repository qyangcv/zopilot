import { assert } from "chai";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("chat window layout styles", function () {
  it("defines a shared base content width token", function () {
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

    assert.include(css, "--zp-detached-navigation-expanded-width: 232px");
    assert.include(css, "--zp-detached-navigation-width: var(");
    assert.include(css, '[data-navigation-expanded="false"]');
    assert.include(css, "--zp-detached-navigation-width: 0px");
    assert.include(css, "--zp-sidebar-gutter: 20px");
    assert.include(css, "--zp-chat-content-max-width: 760px");
    assert.include(css, ".zp-detached-navigation");
    assert.include(
      css,
      "inset-inline-start: var(--zp-detached-navigation-width)",
    );
    assert.include(css, ".zp-detached-session-list");
    assert.include(css, "overflow-y: auto");
    assert.include(css, ".zp-detached-navigation[hidden]");
    assert.include(css, "display: none");
    assert.include(css, ".zp-detached-navigation-resizer");
    assert.include(
      css,
      "inset-inline-start: calc(var(--zp-detached-navigation-width) - 3px)",
    );
    assert.include(css, "cursor: col-resize");
    assert.include(css, "touch-action: none");
    assert.include(css, '[data-navigation-resizing="true"]');
  });

  it("centers the narrower chat content in the detached main area", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );

    assert.include(css, "100% - var(--zp-detached-navigation-width) -");
    assert.include(css, "var(--zp-chat-content-max-width, 760px)");
    assert.include(css, "inset-inline-end: max(");
  });

  it("keeps detached controls in a seamless toolbar above the scroll area", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-shell.css"),
      "utf8",
    );
    const detachedCss = readFileSync(
      resolve("addon/content/styles/detached-chat-window.css"),
      "utf8",
    );

    assert.include(css, "--zp-header-height: 0px");
    assert.include(css, "--zp-detached-toolbar-height: 38px");
    assert.include(css, ".zp-detached-toolbar");
    assert.include(css, ".zp-detached-restore-button");
    assert.include(css, ".zp-detached-navigation-button");
    assert.include(css, "inset-block-start: var(--zp-detached-toolbar-height)");
    assert.include(
      css,
      "inset-inline-start: var(--zp-detached-navigation-width)",
    );
    assert.include(css, "height: var(--zp-detached-toolbar-height)");
    assert.include(css, "justify-content: space-between");
    assert.include(css, "padding: 6px 12px");
    assert.include(css, "border: 0");
    assert.include(css, "background: transparent");
    assert.include(css, "background: transparent !important");
    assert.include(css, "box-shadow: none");
    assert.notInclude(css, "padding-block-start: 44px");
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

  it("keeps tool duration next to the shrinkable tool name", function () {
    const css = readFileSync(
      resolve("addon/content/styles/sidebar-messages.css"),
      "utf8",
    );

    assert.match(
      css,
      /\.zp-trace-tool-kind\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*35%;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/su,
    );
    assert.match(css, /\.zp-trace-tool-name\s*\{[^}]*flex:\s*0 1 auto;/su);
  });
});
