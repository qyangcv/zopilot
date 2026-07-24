type PaneWidthTarget = {
  pane: Element;
  sibling: Element;
  splitter: Element;
  standard: boolean;
};

type PaneWidthState = {
  canMaximize: boolean;
  maximized: boolean;
};

type PaneWidthControllerOptions = {
  onStateChange: (state: PaneWidthState) => void;
  onWarning?: (message: string, error?: unknown) => void;
};

type WidthElement = Element & {
  style?: CSSStyleDeclaration;
};

type WidthSnapshot = {
  pane: WidthElement;
  attribute: string | null;
  styleValue: string;
  stylePriority: string;
  measuredWidth: number;
  writtenAttribute: string;
  writtenStyle: string;
};

const initialPaneWidthState: PaneWidthState = {
  canMaximize: false,
  maximized: false,
};

class PaneWidthController {
  private target?: PaneWidthTarget;
  private snapshot?: WidthSnapshot;
  private state = initialPaneWidthState;
  private listeningSplitter?: Element;

  private readonly onSplitterMouseMove = () => {
    if (
      this.state.maximized &&
      this.listeningSplitter?.getAttribute("state") === "dragging"
    ) {
      this.releaseToNativeResize();
    }
  };

  constructor(
    private readonly win: Window,
    private readonly options: PaneWidthControllerOptions,
  ) {}

  getState(): PaneWidthState {
    return this.state;
  }

  reconcile(target: PaneWidthTarget | undefined): void {
    if (!this.isUsableTarget(target)) {
      this.restore();
      this.setTarget(undefined);
      this.publish(initialPaneWidthState);
      return;
    }

    if (this.target?.pane !== target.pane) {
      this.restore();
      this.setTarget(target);
    } else {
      this.setTarget(target);
    }

    const maximum = this.measureMaximum(target);
    if (maximum === undefined) {
      this.fail("could not calculate a safe sidebar maximum width");
      return;
    }

    if (this.snapshot) {
      if (!this.writeMaximum(maximum)) {
        this.fail("could not update the maximized sidebar width");
        return;
      }
      this.publish({ canMaximize: true, maximized: true });
      return;
    }

    this.publish({ canMaximize: true, maximized: false });
  }

  toggle(): void {
    if (this.snapshot) {
      this.restore();
      this.publish({
        canMaximize: Boolean(
          this.target && this.measureMaximum(this.target) !== undefined,
        ),
        maximized: false,
      });
      return;
    }

    const target = this.target;
    if (!this.isUsableTarget(target)) {
      this.publish(initialPaneWidthState);
      return;
    }
    const maximum = this.measureMaximum(target);
    if (maximum === undefined) {
      this.fail("could not calculate a safe sidebar maximum width");
      return;
    }
    const pane = target.pane as WidthElement;
    const style = pane.style;
    const measuredWidth = pane.getBoundingClientRect().width;
    if (!style || !isPositiveFinite(measuredWidth)) {
      this.fail("could not capture the current sidebar width");
      return;
    }
    this.snapshot = {
      pane,
      attribute: pane.getAttribute("width"),
      styleValue: style.getPropertyValue("width"),
      stylePriority: style.getPropertyPriority("width"),
      measuredWidth,
      writtenAttribute: "",
      writtenStyle: "",
    };
    if (!this.writeMaximum(maximum)) {
      this.fail("could not maximize the sidebar");
      return;
    }
    this.publish({ canMaximize: true, maximized: true });
  }

  close(): void {
    this.restore();
    this.setTarget(undefined);
    this.publish(initialPaneWidthState);
  }

  destroy(): void {
    this.close();
  }

  private isUsableTarget(
    target: PaneWidthTarget | undefined,
  ): target is PaneWidthTarget {
    if (!target?.standard) return false;
    const elements = [target.pane, target.sibling, target.splitter];
    return elements.every(
      (element) =>
        element.ownerDocument === this.win.document &&
        element.isConnected &&
        typeof element.getBoundingClientRect === "function",
    );
  }

  private measureMaximum(target: PaneWidthTarget): number | undefined {
    try {
      const paneWidth = target.pane.getBoundingClientRect().width;
      const siblingWidth = target.sibling.getBoundingClientRect().width;
      const computedStyle = this.win.getComputedStyle(target.sibling);
      const minWidth = Number.parseFloat(computedStyle?.minWidth || "");
      if (
        !isPositiveFinite(paneWidth) ||
        !Number.isFinite(siblingWidth) ||
        siblingWidth < 0 ||
        !Number.isFinite(minWidth) ||
        minWidth < 0
      ) {
        return undefined;
      }
      return Math.max(
        1,
        Math.floor(paneWidth + Math.max(0, siblingWidth - minWidth)),
      );
    } catch (error) {
      this.options.onWarning?.(
        "failed to inspect Zotero sidebar layout",
        error,
      );
      return undefined;
    }
  }

  private writeMaximum(width: number): boolean {
    const snapshot = this.snapshot;
    if (!snapshot?.pane.style) return false;
    const attribute = String(width);
    const styleValue = `${width}px`;
    try {
      const changed =
        snapshot.pane.getAttribute("width") !== attribute ||
        snapshot.pane.style.getPropertyValue("width") !== styleValue;
      snapshot.pane.setAttribute("width", attribute);
      snapshot.pane.style.setProperty("width", styleValue);
      snapshot.writtenAttribute = attribute;
      snapshot.writtenStyle = styleValue;
      if (changed) this.dispatchResize();
      return true;
    } catch (error) {
      this.options.onWarning?.("failed to write Zotero sidebar width", error);
      return false;
    }
  }

  private restore(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    this.snapshot = undefined;
    const style = snapshot.pane.style;
    if (!style) return;
    let changed = false;
    try {
      if (snapshot.pane.getAttribute("width") === snapshot.writtenAttribute) {
        const fallback = String(
          Math.max(1, Math.round(snapshot.measuredWidth)),
        );
        snapshot.pane.setAttribute("width", snapshot.attribute ?? fallback);
        changed = true;
      }
      if (style.getPropertyValue("width") === snapshot.writtenStyle) {
        if (snapshot.styleValue) {
          style.setProperty(
            "width",
            snapshot.styleValue,
            snapshot.stylePriority,
          );
        } else {
          style.removeProperty("width");
        }
        changed = true;
      }
    } catch (error) {
      this.options.onWarning?.("failed to restore Zotero sidebar width", error);
    }
    if (changed) this.dispatchResize();
  }

  private releaseToNativeResize(): void {
    this.snapshot = undefined;
    this.publish({ canMaximize: true, maximized: false });
  }

  private fail(message: string): void {
    this.options.onWarning?.(message);
    this.restore();
    this.setTarget(undefined);
    this.publish(initialPaneWidthState);
  }

  private setTarget(target: PaneWidthTarget | undefined): void {
    if (this.listeningSplitter !== target?.splitter) {
      this.listeningSplitter?.removeEventListener(
        "mousemove",
        this.onSplitterMouseMove,
      );
      target?.splitter.addEventListener("mousemove", this.onSplitterMouseMove);
      this.listeningSplitter = target?.splitter;
    }
    this.target = target;
  }

  private publish(state: PaneWidthState): void {
    if (
      state.canMaximize === this.state.canMaximize &&
      state.maximized === this.state.maximized
    ) {
      return;
    }
    this.state = state;
    this.options.onStateChange(state);
  }

  private dispatchResize(): void {
    try {
      this.win.dispatchEvent(new this.win.Event("resize"));
    } catch (error) {
      this.options.onWarning?.(
        "failed to notify Zotero after sidebar resize",
        error,
      );
    }
  }
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export { PaneWidthController };
export type { PaneWidthControllerOptions, PaneWidthState, PaneWidthTarget };
