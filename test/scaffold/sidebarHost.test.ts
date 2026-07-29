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

  it("keeps the focused composer geometry stable while its content scrolls", async function () {
    this.timeout(10_000);
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;
    const button = doc.querySelector(
      '.zp-library-sidenav-button[data-pane="zopilot-library"]',
    ) as HTMLButtonElement | null;
    if (!button) this.skip();

    button.click();
    const textarea = await waitForElement(
      win,
      () => {
        const candidate = doc.querySelector(
          ".zp-composer-input",
        ) as HTMLTextAreaElement | null;
        return candidate && !candidate.disabled ? candidate : null;
      },
      300,
    );
    assert.exists(textarea, "enabled Zopilot composer textarea");
    if (!textarea) return;

    const originalValue = textarea.value;
    const originalSelectionStart = textarea.selectionStart;
    const originalSelectionEnd = textarea.selectionEnd;
    const longText = Array.from(
      { length: 256 },
      (_, index) => `Long composer line ${index + 1}`,
    ).join("\n");

    try {
      textarea.blur();
      await waitForFrame(win);
      const initialLayout = readComposerLayout(win, textarea);

      setNativeTextareaValue(win, textarea, longText, "insertReplacementText");
      await waitForFrames(win, 2);
      assert.equal(textarea.value, longText);
      assert.deepEqual(
        readComposerLayout(win, textarea),
        initialLayout,
        "long text must not resize the unfocused composer",
      );
      assert.equal(initialLayout.overflowY, "auto");
      assert.isAbove(
        textarea.scrollHeight,
        textarea.clientHeight,
        "long content should overflow inside the composer",
      );
      textarea.scrollTop = textarea.scrollHeight;
      assert.isAbove(
        textarea.scrollTop,
        0,
        "overflowing composer content should be internally scrollable",
      );

      textarea.focus();
      await waitForFrame(win);
      assert.strictEqual(doc.activeElement, textarea);
      assert.deepEqual(
        readComposerLayout(win, textarea),
        initialLayout,
        "focus must not resize the composer or change its overflow",
      );

      textarea.select();
      await waitForFrame(win);
      assert.equal(textarea.selectionStart, 0);
      assert.equal(textarea.selectionEnd, longText.length);
      assert.deepEqual(
        readComposerLayout(win, textarea),
        initialLayout,
        "selecting all text must keep the composer geometry stable",
      );

      textarea.blur();
      await waitForFrame(win);
      setNativeTextareaValue(win, textarea, "", "deleteContentBackward");
      await waitForFrames(win, 2);
      assert.equal(textarea.value, "");
      assert.deepEqual(
        readComposerLayout(win, textarea),
        initialLayout,
        "deleting the selection must keep the composer geometry stable",
      );
    } finally {
      textarea.blur();
      await waitForFrame(win);
      if (textarea.isConnected) {
        setNativeTextareaValue(
          win,
          textarea,
          originalValue,
          "insertReplacementText",
        );
        await waitForFrames(win, 2);
        const selectionStart = Math.min(
          originalSelectionStart,
          originalValue.length,
        );
        const selectionEnd = Math.min(
          originalSelectionEnd,
          originalValue.length,
        );
        textarea.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  });
});

type ComposerLayoutSnapshot = {
  clientHeight: number;
  height: string;
  maxHeight: string;
  overflowY: string;
};

function readComposerLayout(
  win: Window,
  textarea: HTMLTextAreaElement,
): ComposerLayoutSnapshot {
  const style = win.getComputedStyle(textarea);
  return {
    clientHeight: textarea.clientHeight,
    height: style.height,
    maxHeight: style.maxHeight,
    overflowY: style.overflowY,
  };
}

function setNativeTextareaValue(
  win: Window,
  textarea: HTMLTextAreaElement,
  value: string,
  inputType: string,
): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea) as object,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Native textarea value setter is unavailable");
  }
  valueSetter.call(textarea, value);
  textarea.dispatchEvent(
    new win.InputEvent("input", {
      bubbles: true,
      data: inputType.startsWith("delete") ? null : value,
      inputType,
    }),
  );
}

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

async function waitForFrames(win: Window, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await waitForFrame(win);
  }
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
