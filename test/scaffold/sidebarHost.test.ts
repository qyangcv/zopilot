import { assert } from "chai";
import {
  registerSidebar,
  unregisterSidebar,
} from "../../src/features/sidebar/host/SidebarHostController";

describe("sidebar host integration", function () {
  it("keeps one host of each kind across unregister/register", async function () {
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;

    assertAtMostOne(
      doc,
      '.zp-context-sidenav-button[data-pane="zopilot-context"]',
    );
    assertAtMostOne(
      doc,
      '.zp-context-sidenav-button[data-pane="zopilot-library"]',
    );
    assertAtMostOne(doc, "#zopilot-context-pane-deck");
    assertAtMostOne(doc, "#zopilot-library-item-pane-deck");
    assertAtMostOne(doc, "#zopilot-portal-root");

    unregisterSidebar(win);
    await waitForFrame(win);
    assert.equal(doc.querySelectorAll("#zopilot-context-pane-deck").length, 0);
    assert.equal(
      doc.querySelectorAll("#zopilot-library-item-pane-deck").length,
      0,
    );
    assert.equal(doc.querySelectorAll("#zopilot-portal-root").length, 0);

    registerSidebar(win);
    await waitForFrame(win);
    assertAtMostOne(doc, "#zopilot-context-pane-deck");
    assertAtMostOne(doc, "#zopilot-library-item-pane-deck");
    assertAtMostOne(doc, "#zopilot-portal-root");
  });

  it("mounts the portal above both Library and Reader tabs", async function () {
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;
    const button = doc.querySelector(
      '.zp-library-sidenav-button[data-pane="zopilot-library"]',
    ) as HTMLButtonElement | null;
    if (!button) this.skip();

    button.click();
    const portal = await waitForElement(win, () =>
      doc.getElementById("zopilot-portal-root"),
    );
    assert.exists(portal);
    assert.equal(portal?.parentElement?.id, "zotero-pane-stack");
    assert.notEqual(portal?.parentElement?.id, "zotero-pane");
  });
});

function assertAtMostOne(doc: Document, selector: string): void {
  assert.isAtMost(
    doc.querySelectorAll(selector).length,
    1,
    `duplicate nodes for ${selector}`,
  );
}

function waitForFrame(win: Window): Promise<void> {
  return new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
}

async function waitForElement<T extends Element>(
  win: Window,
  resolveElement: () => T | null,
  frameLimit = 20,
): Promise<T | null> {
  for (let frame = 0; frame < frameLimit; frame += 1) {
    const element = resolveElement();
    if (element) return element;
    await waitForFrame(win);
  }
  return resolveElement();
}
