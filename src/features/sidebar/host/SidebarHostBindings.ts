import { copyText } from "../ui/clipboard";
import type { SidebarPromptView } from "../ui/types";
import {
  HostMutationCoordinator,
  type HostMutationTargets,
} from "./HostMutationCoordinator";

type SidebarHostBindingsOptions = {
  doc: Document;
  win: Window;
  ensureMountedSurfaces: () => void;
  refreshContext: () => void;
  syncWithSelectedContext: () => void;
  isOpen: () => boolean;
  isDestroyed: () => boolean;
  getDeckPanel: () => Element | undefined;
  getHostMutationTargets: () => HostMutationTargets;
  subscribePrompts: (
    listener: (prompts: SidebarPromptView[]) => void,
  ) => () => void;
  updatePrompts: (prompts: SidebarPromptView[]) => void;
  subscribeProviders: () => () => void;
};

class SidebarHostBindings {
  private treeDisposer?: () => void;
  private copyDisposer?: () => void;

  constructor(private readonly options: SidebarHostBindingsOptions) {}

  bind(): Array<() => void> {
    this.refreshDynamicBindings();
    return [
      ...this.bindContextRefresh(),
      ...this.bindLayoutRefresh(),
      this.options.subscribePrompts((prompts) => {
        if (!this.options.isDestroyed()) this.options.updatePrompts(prompts);
      }),
      this.options.subscribeProviders(),
      () => this.disposeDynamicBindings(),
    ];
  }

  private bindContextRefresh(): Array<() => void> {
    let frame: number | undefined;
    const refreshSoon = () => {
      if (frame !== undefined) return;
      frame = this.options.win.requestAnimationFrame(() => {
        frame = undefined;
        if (!this.options.isDestroyed()) {
          this.options.syncWithSelectedContext();
        }
      });
    };
    this.treeRefresh = refreshSoon;
    this.refreshTreeBindings();
    return [
      () => {
        this.treeRefresh = undefined;
        this.treeDisposer?.();
        this.treeDisposer = undefined;
        if (frame !== undefined) {
          this.options.win.cancelAnimationFrame(frame);
          frame = undefined;
        }
      },
    ];
  }

  private bindLayoutRefresh(): Array<() => void> {
    const coordinator = new HostMutationCoordinator(this.options.win, {
      getTargets: this.options.getHostMutationTargets,
      reconcile: () => {
        this.options.ensureMountedSurfaces();
        this.refreshDynamicBindings();
        if (!this.options.isOpen()) this.options.refreshContext();
      },
    });
    coordinator.mount();
    let contextFrame: number | undefined;
    const reloadConversationSoon = () => {
      if (contextFrame !== undefined) return;
      contextFrame = this.options.win.requestAnimationFrame(() => {
        contextFrame = undefined;
        if (!this.options.isDestroyed()) {
          this.options.syncWithSelectedContext();
        }
      });
    };
    const scheduleLayout = () => coordinator.schedule();
    this.options.win.addEventListener("focus", reloadConversationSoon);
    this.options.win.addEventListener("resize", scheduleLayout);
    const tabObserverID = Zotero.Notifier.registerObserver(
      {
        notify: (event, type) => {
          if (
            type === "tab" &&
            (event === "select" ||
              (event as string) === "load" ||
              (event as string) === "close")
          ) {
            reloadConversationSoon();
          }
        },
      },
      ["tab"],
      "zopilot-sidebar-tabs",
      100,
    );
    return [
      () => coordinator.destroy(),
      () => {
        this.options.win.removeEventListener("focus", reloadConversationSoon);
        this.options.win.removeEventListener("resize", scheduleLayout);
        if (contextFrame !== undefined) {
          this.options.win.cancelAnimationFrame(contextFrame);
          contextFrame = undefined;
        }
      },
      () => Zotero.Notifier.unregisterObserver(tabObserverID),
    ];
  }

  private treeRefresh?: () => void;

  private refreshDynamicBindings(): void {
    this.refreshTreeBindings();
    this.refreshCopyBinding();
  }

  private disposeDynamicBindings(): void {
    this.treeDisposer?.();
    this.treeDisposer = undefined;
    this.copyDisposer?.();
    this.copyDisposer = undefined;
  }

  private refreshTreeBindings(): void {
    const refresh = this.treeRefresh;
    if (!refresh) return;
    const trees = [
      this.options.doc.getElementById("zotero-collections-tree"),
      this.options.doc.getElementById("zotero-items-tree"),
    ].filter((tree): tree is Element => Boolean(tree));
    this.treeDisposer?.();
    const handleTreeInteraction = () => refresh();
    trees.forEach((tree) => {
      tree.addEventListener("mousedown", handleTreeInteraction, true);
      tree.addEventListener("keyup", handleTreeInteraction, true);
    });
    this.treeDisposer = () => {
      trees.forEach((tree) => {
        tree.removeEventListener("mousedown", handleTreeInteraction, true);
        tree.removeEventListener("keyup", handleTreeInteraction, true);
      });
    };
  }

  private refreshCopyBinding(): void {
    const panel = this.options.getDeckPanel();
    this.copyDisposer?.();
    this.copyDisposer = undefined;
    if (!panel) return;
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
    panel.addEventListener("copy", copySelection as EventListener, true);
    this.copyDisposer = () =>
      panel.removeEventListener("copy", copySelection as EventListener, true);
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
