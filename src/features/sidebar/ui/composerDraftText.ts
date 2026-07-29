type TextInsertion = {
  cursor: number;
  text: string;
};

type TextSnapshot = {
  end: number;
  start: number;
  text: string;
};

type TextEditOptions = {
  cursor?: number;
  refocus?: boolean;
};

type TextControl = Pick<
  HTMLTextAreaElement,
  | "blur"
  | "focus"
  | "isConnected"
  | "selectionEnd"
  | "selectionStart"
  | "setRangeText"
  | "setSelectionRange"
  | "value"
>;

type ScheduledTask = unknown;

type TextSessionScheduler = {
  cancel: (task: ScheduledTask) => void;
  schedule: (callback: () => void) => ScheduledTask;
};

type PendingEdit = {
  baseText: string;
  control: TextControl | null;
  cursor: number;
  end: number;
  generation: number;
  kind: "range" | "replace-all";
  refocus: boolean;
  replacement: string;
  start: number;
};

type ComposerTextSessionOptions = {
  getControl: () => TextControl | null;
  onTextChange: (text: string, cursor: number) => void;
  scheduler?: TextSessionScheduler;
};

const defaultScheduler: TextSessionScheduler = {
  cancel: (task) =>
    globalThis.clearTimeout(task as ReturnType<typeof globalThis.setTimeout>),
  schedule: (callback) => globalThis.setTimeout(callback, 0),
};

/**
 * Owns every non-native edit to the composer textarea.
 *
 * Ordinary typing, selection, clipboard, undo, and redo stay entirely inside
 * Gecko's native editor. External edits first blur that editor, wait for the
 * native text-input session to finish, mutate once, and only then refocus.
 */
class ComposerTextSession {
  private readonly getControl: () => TextControl | null;
  private readonly onTextChange: (text: string, cursor: number) => void;
  private readonly scheduler: TextSessionScheduler;
  private composing = false;
  private flushTask?: ScheduledTask;
  private focusTask?: ScheduledTask;
  private generation = 0;
  private pending?: PendingEdit;
  private text = "";

  constructor(options: ComposerTextSessionOptions) {
    this.getControl = options.getControl;
    this.onTextChange = options.onTextChange;
    this.scheduler = options.scheduler || defaultScheduler;
  }

  read(): TextSnapshot {
    const control = this.getControl();
    const text = control?.value ?? this.text;
    const start = clampOffset(
      control?.selectionStart ?? text.length,
      text.length,
    );
    const end = clampOffset(control?.selectionEnd ?? start, text.length);
    return { end, start, text };
  }

  handleNativeInput(control: TextControl): void {
    const cursor = clampOffset(
      control.selectionStart ?? control.value.length,
      control.value.length,
    );
    this.publish(control.value, cursor);
  }

  handleCompositionStart(): void {
    this.composing = true;
  }

  handleCompositionEnd(control: TextControl): void {
    this.composing = false;
    this.handleNativeInput(control);
    this.scheduleFlush();
  }

  handleBlur(): void {
    // blur is the explicit boundary after which a queued script edit may run.
    this.composing = false;
    this.scheduleFlush();
  }

  insert(text: string, options: TextEditOptions = {}): TextInsertion {
    const current = this.read();
    const insertion = insertTextAtSelection(
      current.text,
      text,
      current.start,
      current.end,
    );
    this.replaceRange(current.start, current.end, text, {
      cursor: insertion.cursor,
      refocus: options.refocus,
    });
    return insertion;
  }

  replaceAll(text: string, options: TextEditOptions = {}): TextInsertion {
    const current = this.read();
    const cursor = clampOffset(options.cursor ?? text.length, text.length);
    this.queueEdit({
      baseText: current.text,
      cursor,
      end: current.text.length,
      kind: "replace-all",
      refocus: options.refocus ?? true,
      replacement: text,
      start: 0,
    });
    return { cursor, text };
  }

  replaceRange(
    start: number,
    end: number,
    replacement: string,
    options: TextEditOptions = {},
  ): TextInsertion {
    const current = this.read();
    const rangeStart = clampOffset(Math.min(start, end), current.text.length);
    const rangeEnd = clampOffset(Math.max(start, end), current.text.length);
    const text =
      current.text.slice(0, rangeStart) +
      replacement +
      current.text.slice(rangeEnd);
    const cursor = clampOffset(
      options.cursor ?? rangeStart + replacement.length,
      text.length,
    );
    this.queueEdit({
      baseText: current.text,
      cursor,
      end: rangeEnd,
      kind: "range",
      refocus: options.refocus ?? true,
      replacement,
      start: rangeStart,
    });
    return { cursor, text };
  }

  cancelPending(): void {
    this.generation += 1;
    this.pending = undefined;
    this.cancelScheduledTasks();
  }

  private queueEdit(edit: Omit<PendingEdit, "control" | "generation">): void {
    this.generation += 1;
    this.cancelScheduledTasks();
    const control = this.getControl();
    this.pending = {
      ...edit,
      control,
      generation: this.generation,
    };
    control?.blur();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.pending || this.flushTask !== undefined) return;
    this.flushTask = this.scheduler.schedule(() => {
      this.flushTask = undefined;
      this.flush();
    });
  }

  private flush(): void {
    const edit = this.pending;
    if (!edit || edit.generation !== this.generation || this.composing) return;
    const control = this.getControl();
    if (
      (edit.control && edit.control !== control) ||
      control?.isConnected === false
    ) {
      this.pending = undefined;
      return;
    }
    if (!control) {
      const text = applyEdit(edit.baseText, edit);
      this.pending = undefined;
      this.publish(text, edit.cursor);
      return;
    }
    if (edit.kind === "range" && control.value !== edit.baseText) {
      // A composition or another native edit won the race. Never apply stale
      // offsets to a newer native buffer.
      this.pending = undefined;
      this.publish(
        control.value,
        clampOffset(
          control.selectionStart ?? control.value.length,
          control.value.length,
        ),
      );
      return;
    }

    const end = edit.kind === "replace-all" ? control.value.length : edit.end;
    control.setRangeText(edit.replacement, edit.start, end, "end");
    const cursor = clampOffset(edit.cursor, control.value.length);
    control.setSelectionRange(cursor, cursor);
    this.pending = undefined;
    this.publish(control.value, cursor);

    if (!edit.refocus) return;
    const generation = edit.generation;
    this.focusTask = this.scheduler.schedule(() => {
      this.focusTask = undefined;
      if (
        generation !== this.generation ||
        control !== this.getControl() ||
        control.isConnected === false
      ) {
        return;
      }
      control.focus({ preventScroll: true });
      control.setSelectionRange(cursor, cursor);
    });
  }

  private publish(text: string, cursor: number): void {
    this.text = text;
    this.onTextChange(text, cursor);
  }

  private cancelScheduledTasks(): void {
    if (this.flushTask !== undefined) {
      this.scheduler.cancel(this.flushTask);
      this.flushTask = undefined;
    }
    if (this.focusTask !== undefined) {
      this.scheduler.cancel(this.focusTask);
      this.focusTask = undefined;
    }
  }
}

function applyEdit(text: string, edit: PendingEdit): string {
  const end = edit.kind === "replace-all" ? text.length : edit.end;
  return text.slice(0, edit.start) + edit.replacement + text.slice(end);
}

function insertTextAtSelection(
  current: string,
  inserted: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): TextInsertion {
  const start = clampOffset(selectionStart ?? current.length, current.length);
  const end = clampOffset(selectionEnd ?? start, current.length);
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);

  return {
    cursor: rangeStart + inserted.length,
    text: current.slice(0, rangeStart) + inserted + current.slice(rangeEnd),
  };
}

function clampOffset(offset: number, textLength: number): number {
  return Math.min(Math.max(Math.trunc(offset), 0), textLength);
}

export { ComposerTextSession, insertTextAtSelection };
export type {
  ComposerTextSessionOptions,
  TextControl,
  TextEditOptions,
  TextInsertion,
  TextSessionScheduler,
  TextSnapshot,
};
