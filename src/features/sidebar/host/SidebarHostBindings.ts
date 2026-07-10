import { copyText } from "../ui/clipboard";
import type { SidebarPromptView } from "../ui/types";

type SidebarHostBindingsOptions = {
  doc: Document;
  win: Window;
  ensureMountedSurfaces: () => void;
  refreshContext: () => void;
  syncWithSelectedContext: () => void;
  isOpen: () => boolean;
  isDestroyed: () => boolean;
  areSessionsOpen: () => boolean;
  getDeckPanel: () => HTMLElement | undefined;
  hideSessions: () => void;
  subscribePrompts: (
    listener: (prompts: SidebarPromptView[]) => void,
  ) => () => void;
  updatePrompts: (prompts: SidebarPromptView[]) => void;
  subscribeProviders: () => () => void;
};

class SidebarHostBindings {
  constructor(private readonly options: SidebarHostBindingsOptions) {}

  bind(): Array<() => void> {
    return [
      ...this.bindContextRefresh(),
      ...this.bindLayoutRefresh(),
      this.options.subscribePrompts((prompts) => {
        if (!this.options.isDestroyed()) this.options.updatePrompts(prompts);
      }),
      this.options.subscribeProviders(),
      this.bindSelectionCopy(),
      this.bindSessionPopoverDismiss(),
    ];
  }

  private bindContextRefresh(): Array<() => void> {
    const refreshSoon = () => {
      this.options.win.setTimeout(this.options.syncWithSelectedContext, 0);
    };
    const handleTreeInteraction = (event: Event) => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (!target.closest("#zotero-collections-tree, #zotero-items-tree")) {
        return;
      }
      refreshSoon();
    };
    this.options.doc.addEventListener("mousedown", handleTreeInteraction, true);
    this.options.doc.addEventListener("keyup", handleTreeInteraction, true);
    return [
      () => {
        this.options.doc.removeEventListener(
          "mousedown",
          handleTreeInteraction,
          true,
        );
        this.options.doc.removeEventListener(
          "keyup",
          handleTreeInteraction,
          true,
        );
      },
    ];
  }

  private bindLayoutRefresh(): Array<() => void> {
    const refreshLayoutSoon = () => {
      this.options.win.setTimeout(() => {
        this.options.ensureMountedSurfaces();
        if (!this.options.isOpen()) this.options.refreshContext();
      }, 0);
    };
    const reloadConversationSoon = () => {
      this.options.win.setTimeout(this.options.syncWithSelectedContext, 0);
    };
    const observer = new this.options.win.MutationObserver(refreshLayoutSoon);
    observer.observe(this.options.doc.documentElement, {
      childList: true,
      subtree: true,
    });
    this.options.win.addEventListener("focus", reloadConversationSoon);
    this.options.win.addEventListener("resize", refreshLayoutSoon);
    const tabContainer = this.options.doc.getElementById("tabbrowser-tabs");
    tabContainer?.addEventListener("TabSelect", reloadConversationSoon);
    return [
      () => observer.disconnect(),
      () => {
        this.options.win.removeEventListener("focus", reloadConversationSoon);
        this.options.win.removeEventListener("resize", refreshLayoutSoon);
      },
      () =>
        tabContainer?.removeEventListener("TabSelect", reloadConversationSoon),
    ];
  }

  private bindSessionPopoverDismiss(): () => void {
    const dismiss = (event: Event) => {
      if (!this.options.areSessionsOpen()) return;
      const target = event.target as Node | null;
      if (target && this.options.getDeckPanel()?.contains(target)) return;
      this.options.hideSessions();
    };
    this.options.doc.addEventListener("click", dismiss);
    return () => this.options.doc.removeEventListener("click", dismiss);
  }

  private bindSelectionCopy(): () => void {
    const copySelection = (event: ClipboardEvent) => {
      const text = getSidebarSelectionText(
        this.options.win,
        this.options.getDeckPanel(),
      );
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      void copyText(text, this.options.win);
    };
    this.options.doc.addEventListener("copy", copySelection, true);
    return () =>
      this.options.doc.removeEventListener("copy", copySelection, true);
  }
}

function getSidebarSelectionText(win: Window, root?: Node): string {
  const selection = win.getSelection();
  if (
    !root ||
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    !root.contains(selection.anchorNode) ||
    !root.contains(selection.focusNode)
  ) {
    return "";
  }
  return selection.toString();
}

export { SidebarHostBindings, getSidebarSelectionText };
export type { SidebarHostBindingsOptions };
