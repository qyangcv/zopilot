import { assert } from "chai";
import {
  ComposerTextSession,
  insertTextAtSelection,
  type TextControl,
  type TextSessionScheduler,
} from "../../../src/features/sidebar/ui/composerDraftText.ts";

describe("sidebar composer native text session", function () {
  it("inserts at the cursor without replacing the existing draft", function () {
    assert.deepEqual(insertTextAtSelection("before after", "Prompt-3", 7, 7), {
      cursor: 15,
      text: "before Prompt-3after",
    });
  });

  it("replaces only the selected range", function () {
    assert.deepEqual(insertTextAtSelection("keep OLD tail", "new", 5, 8), {
      cursor: 8,
      text: "keep new tail",
    });
  });

  it("appends when the editor selection is unavailable", function () {
    assert.deepEqual(insertTextAtSelection("existing", " prompt"), {
      cursor: 15,
      text: "existing prompt",
    });
  });

  it("leaves ordinary native edits entirely inside the textarea", function () {
    const fixture = createFixture("native");
    fixture.control.value = "native paste";
    fixture.control.selectionStart = 12;
    fixture.control.selectionEnd = 12;

    fixture.session.handleNativeInput(fixture.control);

    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.changes, [["native paste", 12]]);
  });

  it("ends the native session before applying one external edit", function () {
    const fixture = createFixture("old text");

    fixture.session.replaceAll("Prompt-3", { cursor: 4 });

    assert.deepEqual(fixture.calls, [["blur"]]);
    assert.deepEqual(fixture.changes, []);

    fixture.scheduler.runNext();

    assert.equal(fixture.control.value, "Prompt-3");
    assert.deepEqual(fixture.calls, [
      ["blur"],
      ["setRangeText", "Prompt-3", 0, 8, "end"],
      ["setSelectionRange", 4, 4],
    ]);
    assert.deepEqual(fixture.changes, [["Prompt-3", 4]]);

    fixture.scheduler.runNext();

    assert.deepEqual(fixture.calls.slice(-2), [
      ["focus", true],
      ["setSelectionRange", 4, 4],
    ]);
  });

  it("waits for composition to end before changing the native buffer", function () {
    const fixture = createFixture("拼");
    fixture.session.handleCompositionStart();

    fixture.session.replaceAll("完成");
    fixture.scheduler.runNext();

    assert.deepEqual(fixture.calls, [["blur"]]);
    assert.equal(fixture.control.value, "拼");

    fixture.session.handleCompositionEnd(fixture.control);
    fixture.scheduler.runNext();

    assert.equal(fixture.control.value, "完成");
    assert.deepEqual(fixture.changes, [
      ["拼", 1],
      ["完成", 2],
    ]);
  });

  it("does not apply stale range offsets after a newer native edit", function () {
    const fixture = createFixture("@paper");

    fixture.session.replaceRange(0, 6, "");
    fixture.control.value = "@paper newer";
    fixture.control.selectionStart = 12;
    fixture.control.selectionEnd = 12;
    fixture.scheduler.runNext();

    assert.equal(fixture.control.value, "@paper newer");
    assert.notDeepInclude(fixture.calls, ["setRangeText", "", 0, 6, "end"]);
    assert.deepEqual(fixture.changes, [["@paper newer", 12]]);
  });

  it("cancels a delayed refocus when a newer transaction starts", function () {
    const fixture = createFixture("one");

    fixture.session.replaceAll("two");
    fixture.scheduler.runNext();
    fixture.session.replaceAll("three");
    fixture.scheduler.runAll();

    assert.equal(fixture.control.value, "three");
    assert.equal(fixture.calls.filter((call) => call[0] === "focus").length, 1);
  });

  it("cancels a delayed refocus when native input wins the race", function () {
    const fixture = createFixture("old");

    fixture.session.replaceAll("Prompt-3");
    fixture.scheduler.runNext();
    const callCountBeforeNativeInput = fixture.calls.length;

    fixture.control.value = "";
    fixture.control.selectionStart = 0;
    fixture.control.selectionEnd = 0;
    fixture.session.handleNativeInput(fixture.control);
    fixture.scheduler.runAll();

    assert.deepEqual(fixture.changes, [
      ["Prompt-3", 8],
      ["", 0],
    ]);
    assert.deepEqual(
      fixture.calls.slice(callCountBeforeNativeInput),
      [],
      "an obsolete script task must not focus or rewrite selection after native input",
    );
  });
});

function createFixture(initialValue: string) {
  const calls: unknown[][] = [];
  const changes: Array<[string, number]> = [];
  const scheduler = createScheduler();
  const control: TextControl = {
    value: initialValue,
    selectionStart: initialValue.length,
    selectionEnd: initialValue.length,
    isConnected: true,
    blur() {
      calls.push(["blur"]);
    },
    focus(options) {
      calls.push(["focus", options?.preventScroll]);
    },
    setRangeText(replacement, start, end, selectionMode) {
      calls.push(["setRangeText", replacement, start, end, selectionMode]);
      this.value =
        this.value.slice(0, start) + replacement + this.value.slice(end);
    },
    setSelectionRange(start, end) {
      calls.push(["setSelectionRange", start, end]);
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  const session = new ComposerTextSession({
    getControl: () => control,
    onTextChange: (text, cursor) => changes.push([text, cursor]),
    scheduler,
  });
  return { calls, changes, control, scheduler, session };
}

function createScheduler(): TextSessionScheduler & {
  runAll: () => void;
  runNext: () => void;
} {
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  return {
    cancel(task) {
      tasks.delete(task as number);
    },
    schedule(callback) {
      const id = ++nextId;
      tasks.set(id, callback);
      return id;
    },
    runNext() {
      const entry = tasks.entries().next().value as
        [number, () => void] | undefined;
      if (!entry) return;
      tasks.delete(entry[0]);
      entry[1]();
    },
    runAll() {
      while (tasks.size) this.runNext();
    },
  };
}
