import { getString } from "../../../app/localization";
import { createStaticIconElement } from "../ui/staticIcons";
import { CONTEXT_PANE_DECK_ID, ZOPILOT_CONTEXT_PANE } from "./constants";
import type { ContextPaneActiveState } from "./contextPaneProbe";

type ContextPaneNativeState = Exclude<ContextPaneActiveState, "zopilot">;

class ContextPaneSidenavAdapter {
  private active = false;
  private button?: HTMLButtonElement;
  private listeningSidenav?: Element;
  private nativeState: AttributeWrite[] = [];
  private readonly onClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate();
  };
  private readonly onNativeButtonClick = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (typeof mouseEvent.button === "number" && mouseEvent.button !== 0)
      return;
    const target =
      event.target instanceof this.win.Element
        ? (event.target as Element)
        : undefined;
    if (!target) return;
    const button = target.closest(".btn[data-pane]");
    if (!button || !this.sidenav.contains(button)) return;
    const pane = button.getAttribute("data-pane");
    if (!pane || pane === ZOPILOT_CONTEXT_PANE) return;
    this.options.onActivateNativePane(
      pane === "context-notes" ? "notes" : "item",
    );
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    this.options.onActivate();
  };

  constructor(
    private readonly win: Window,
    private sidenav: Element,
    private readonly options: {
      onActivate: () => void;
      onActivateNativePane: (state: ContextPaneNativeState) => void;
    },
  ) {}

  mount(): void {
    this.reconcile();
  }

  setActive(active: boolean): void {
    const changed = this.active !== active;
    this.active = active;
    this.syncSelectionState({ restoreNativeSelection: changed && !active });
  }

  destroy(): void {
    this.restoreNativeSelectionState();
    this.detachSidenavListener();
    this.button?.removeEventListener("click", this.onClick);
    this.button?.removeEventListener("keydown", this.onKeyDown);
    this.button?.remove();
    this.button = undefined;
  }

  private reconcile(): void {
    const latest = this.win.document.getElementById(
      "zotero-context-pane-sidenav",
    );
    if (latest && latest !== this.sidenav) {
      this.restoreNativeSelectionState();
      this.sidenav = latest;
    }
    if (!this.sidenav.isConnected) {
      this.detachSidenavListener();
      return;
    }
    this.attachSidenavListener(this.sidenav);
    const duplicates = this.sidenav.querySelectorAll(
      `.zp-context-sidenav-button[data-pane="${ZOPILOT_CONTEXT_PANE}"]`,
    );
    (Array.from(duplicates) as Element[]).forEach((existing) => {
      if (existing !== this.button) existing.remove();
    });
    if (!this.button || !this.button.isConnected)
      this.button = this.createButton();
    if (this.button.parentElement !== this.sidenav)
      this.sidenav.append(this.button);
    this.syncSelectionState();
  }

  private syncSelectionState(
    options: { restoreNativeSelection?: boolean } = {},
  ): void {
    this.syncNativeSelectionState(options);
    if (!this.button) return;
    this.button.toggleAttribute("selected", this.active);
    this.button.toggleAttribute("data-active", this.active);
    this.button.setAttribute("aria-selected", String(this.active));
    this.button.setAttribute("aria-pressed", String(this.active));
  }

  private syncNativeSelectionState(options: {
    restoreNativeSelection?: boolean;
  }): void {
    if (!this.active) {
      if (options.restoreNativeSelection) this.restoreNativeSelectionState();
      return;
    }
    if (this.nativeState.length > 0) return;
    const groups = this.sidenav.querySelectorAll(
      ".highlight-notes-inactive, .highlight-notes-active",
    );
    (Array.from(groups) as Element[]).forEach((group) => {
      recordAttributeWrite(this.nativeState, group, "class", () => {
        group.classList.remove("highlight");
      });
      if (group.getAttribute("role") === "tab") {
        recordAttributeWrite(this.nativeState, group, "aria-selected", () =>
          group.setAttribute("aria-selected", "false"),
        );
      }
    });
    (
      Array.from(this.sidenav.querySelectorAll(".btn[data-pane]")) as Element[]
    ).forEach((button) => {
      if (button.getAttribute("data-pane") !== ZOPILOT_CONTEXT_PANE) {
        recordAttributeWrite(this.nativeState, button, "aria-selected", () =>
          button.setAttribute("aria-selected", "false"),
        );
      }
    });
  }

  private restoreNativeSelectionState(): void {
    this.nativeState.splice(0).forEach(restoreAttributeWrite);
  }

  private attachSidenavListener(sidenav: Element): void {
    if (this.listeningSidenav === sidenav) return;
    this.detachSidenavListener();
    sidenav.addEventListener("click", this.onNativeButtonClick, true);
    this.listeningSidenav = sidenav;
  }

  private detachSidenavListener(): void {
    this.listeningSidenav?.removeEventListener(
      "click",
      this.onNativeButtonClick,
      true,
    );
    this.listeningSidenav = undefined;
  }

  private createButton(): HTMLButtonElement {
    const doc = this.win.document;
    const button = doc.createElement("button");
    button.className = "zp-context-sidenav-button";
    button.type = "button";
    button.dataset.pane = ZOPILOT_CONTEXT_PANE;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", CONTEXT_PANE_DECK_ID);
    button.setAttribute("aria-selected", "false");
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", getString("sidebar-title"));
    button.title = getString("sidebar-title");
    button.appendChild(
      createStaticIconElement(doc, "brand", {
        className: "zp-context-sidenav-icon",
        size: 20,
      }),
    );
    button.addEventListener("click", this.onClick);
    button.addEventListener("keydown", this.onKeyDown);
    return button;
  }
}

type AttributeWrite = {
  element: Element;
  name: string;
  before: string | null;
  written: string | null;
};

function recordAttributeWrite(
  writes: AttributeWrite[],
  element: Element,
  name: string,
  write: () => void,
): void {
  const before = element.getAttribute(name);
  write();
  writes.push({
    element,
    name,
    before,
    written: element.getAttribute(name),
  });
}

function restoreAttributeWrite(write: AttributeWrite): void {
  if (write.element.getAttribute(write.name) !== write.written) return;
  if (write.before === null) write.element.removeAttribute(write.name);
  else write.element.setAttribute(write.name, write.before);
}

export { ContextPaneSidenavAdapter };
