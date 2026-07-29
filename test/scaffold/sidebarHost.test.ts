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
    this.timeout(15_000);
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;
    const button = await waitForHostValue(
      win,
      () =>
        doc.querySelector(
          '.zp-library-sidenav-button[data-pane="zopilot-library"]',
        ) as HTMLButtonElement | null,
    );
    if (!button) this.skip();

    const portal = await activateLibraryAndWait(win, button, () =>
      doc.getElementById("zopilot-portal-root"),
    );
    assert.exists(portal);
    assert.equal(portal?.parentElement?.id, "zotero-pane-stack");
    assert.notEqual(portal?.parentElement?.id, "zotero-pane");
  });

  it("keeps the focused composer geometry stable while its content scrolls", async function () {
    this.timeout(20_000);
    const win = Zotero.getMainWindow();
    if (!win) this.skip();
    const doc = win.document;
    const button = await waitForHostValue(
      win,
      () =>
        doc.querySelector(
          '.zp-library-sidenav-button[data-pane="zopilot-library"]',
        ) as HTMLButtonElement | null,
    );
    if (!button) this.skip();

    const textarea = await activateLibraryAndWait(win, button, () => {
      const candidate = doc.querySelector(
        ".zp-composer-input",
      ) as HTMLTextAreaElement | null;
      return candidate && !candidate.disabled ? candidate : null;
    });
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

  it("keeps detached React state and the Gecko editor stable across focused edits", async function () {
    this.timeout(30_000);
    const ownerWindow = Zotero.getMainWindow();
    if (!ownerWindow) this.skip();
    const ownerDocument = ownerWindow.document;
    const libraryButton = await waitForHostValue(
      ownerWindow,
      () =>
        ownerDocument.querySelector(
          '.zp-library-sidenav-button[data-pane="zopilot-library"]',
        ) as HTMLButtonElement | null,
    );
    if (!libraryButton) this.skip();

    const openWindowButton = await activateLibraryAndWait(
      ownerWindow,
      libraryButton,
      () =>
        ownerDocument.querySelector(
          ".zp-sidebar-open-window-button",
        ) as HTMLButtonElement | null,
    );
    assert.exists(openWindowButton, "detached-window action");
    if (!openWindowButton) return;

    let detachedWindow: Window | null = null;
    try {
      openWindowButton.click();
      detachedWindow = await waitForHostValue(
        ownerWindow,
        findDetachedChatWindow,
        10_000,
      );
      assert.exists(detachedWindow, "plugin-owned detached window");
      if (!detachedWindow) return;

      const detachedDocument = detachedWindow.document;
      const textarea = await waitForElement(
        detachedWindow,
        () => {
          const candidate = detachedDocument.querySelector(
            ".zp-composer-input",
          ) as HTMLTextAreaElement | null;
          return candidate && !candidate.disabled ? candidate : null;
        },
        300,
      );
      assert.exists(textarea, "enabled detached composer textarea");
      if (!textarea) return;

      const fontFamily =
        detachedWindow.getComputedStyle(textarea).fontFamily || "";
      assert.include(
        fontFamily,
        "Helvetica Neue",
        "the detached native editor must use a public font family",
      );
      assert.notMatch(
        fontFamily,
        /(?:system-ui|-apple-system|(?:^|[",\s])\.SF)/i,
        "the detached native editor must not expose a hidden system font",
      );

      assert.strictEqual(
        textarea.ownerDocument.defaultView,
        detachedWindow,
        "the editor must belong to the detached chrome document",
      );
      assert.exists(
        textarea.closest('[data-zopilot-root="window"]'),
        "the editor must be mounted in the detached React root",
      );

      const sendButton = readDetachedSendButton(detachedDocument);
      assert.isTrue(
        sendButton.disabled,
        "the empty detached composer must start disabled",
      );

      const inputProcessor = createTestTextInputProcessor(detachedWindow);
      textarea.focus();
      textarea.setSelectionRange(0, 0);
      inputProcessor.insertTextWithKeyPress("Prompt-3");
      await waitForFrames(detachedWindow, 2);
      assert.equal(textarea.value, "Prompt-3");
      assert.isFalse(
        readDetachedSendButton(detachedDocument).disabled,
        "native input must reach detached React draft state",
      );

      const originalParent = textarea.parentElement;
      const initialLayout = readComposerLayout(detachedWindow, textarea);
      textarea.select();
      await waitForFrame(detachedWindow);
      assert.strictEqual(detachedDocument.activeElement, textarea);
      assert.equal(textarea.selectionStart, 0);
      assert.equal(textarea.selectionEnd, textarea.value.length);

      sendBackspace(detachedWindow, inputProcessor);
      await waitForFrames(detachedWindow, 2);

      assert.isTrue(
        readDetachedSendButton(detachedDocument).disabled,
        "native deletion must clear detached React draft state",
      );
      assert.strictEqual(
        detachedDocument.querySelector(".zp-composer-input"),
        textarea,
        "React must retain the native editor node",
      );
      assert.isTrue(textarea.isConnected);
      assert.strictEqual(textarea.parentElement, originalParent);
      assert.strictEqual(
        detachedDocument.activeElement,
        textarea,
        "React handling must not blur or replace the focused editor",
      );
      assert.equal(textarea.value, "");
      assert.deepEqual(
        readComposerLayout(detachedWindow, textarea),
        initialLayout,
        "focused delete handling must not reframe the editor",
      );
    } finally {
      if (detachedWindow && !detachedWindow.closed) {
        const textarea = detachedWindow.document.querySelector(
          ".zp-composer-input",
        ) as HTMLTextAreaElement | null;
        textarea?.blur();
        await waitForFrame(detachedWindow);
        const restoreButton = detachedWindow.document.querySelector(
          ".zp-detached-restore-button",
        ) as HTMLButtonElement | null;
        if (restoreButton) {
          restoreButton.click();
        } else {
          detachedWindow.close();
        }
        await waitForFrames(ownerWindow, 2);
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
  setNativeTextareaBuffer(textarea, value);
  dispatchNativeInput(
    win,
    textarea,
    inputType.startsWith("delete") ? null : value,
    inputType,
  );
}

function dispatchNativeInput(
  win: Window,
  textarea: HTMLTextAreaElement,
  data: string | null,
  inputType: string,
): void {
  textarea.dispatchEvent(
    new win.InputEvent("input", {
      bubbles: true,
      data,
      inputType,
    }),
  );
}

function setNativeTextareaBuffer(
  textarea: HTMLTextAreaElement,
  value: string,
): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(textarea) as object,
    "value",
  )?.set;
  if (!valueSetter) {
    throw new Error("Native textarea value setter is unavailable");
  }
  valueSetter.call(textarea, value);
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

function findDetachedChatWindow(): Window | null {
  const recent = Services.wm.getMostRecentWindow(
    "zopilot:detached-chat",
  ) as unknown as Window | null;
  if (recent && !recent.closed) return recent;

  const windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    const candidate = windows.getNext() as unknown as Window;
    if (candidate.closed) continue;
    const root = candidate.document?.documentElement;
    if (
      root?.id === "zopilot-detached-chat-window" ||
      root?.getAttribute("windowtype") === "zopilot:detached-chat"
    ) {
      return candidate;
    }
  }
  return null;
}

function createTestTextInputProcessor(win: Window): nsITextInputProcessor {
  const processor = Cc["@mozilla.org/text-input-processor;1"].createInstance(
    Ci.nsITextInputProcessor,
  );
  if (
    !processor.beginInputTransactionForTests(win as unknown as mozIDOMWindow)
  ) {
    throw new Error("Gecko text input transaction is unavailable");
  }
  return processor;
}

function sendBackspace(win: Window, processor: nsITextInputProcessor): void {
  const event = new win.KeyboardEvent("", {
    bubbles: true,
    cancelable: true,
    code: processor.computeCodeValueOfNonPrintableKey("Backspace"),
    key: "Backspace",
  });
  processor.keydown(event, processor.KEY_NON_PRINTABLE_KEY);
  processor.keyup(event, processor.KEY_NON_PRINTABLE_KEY);
}

function readDetachedSendButton(doc: Document): HTMLButtonElement {
  const button = doc.querySelector(
    ".zp-send-button",
  ) as HTMLButtonElement | null;
  if (!button) throw new Error("Detached composer send button is unavailable");
  return button;
}

async function activateLibraryAndWait<T>(
  win: Window,
  button: HTMLButtonElement,
  resolveValue: () => T | null,
): Promise<T | null> {
  const current = resolveValue();
  if (current) return current;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    button.click();
    const value = await waitForHostValue(win, resolveValue, 4_000);
    if (value) return value;
  }
  return resolveValue();
}

async function waitForHostValue<T>(
  win: Window,
  resolveValue: () => T | null,
  timeoutMs = 5_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = resolveValue();
    if (value) return value;
    await new Promise<void>((resolve) => win.setTimeout(resolve, 25));
  }
  return resolveValue();
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
  return waitForValue(win, resolveElement, frameLimit);
}

async function waitForValue<T>(
  win: Window,
  resolveValue: () => T | null,
  frameLimit = 20,
): Promise<T | null> {
  for (let frame = 0; frame < frameLimit; frame += 1) {
    const value = resolveValue();
    if (value) return value;
    await waitForFrame(win);
  }
  return resolveValue();
}
