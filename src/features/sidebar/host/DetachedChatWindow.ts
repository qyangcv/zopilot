import { createLogger } from "../../../runtime/logging/logger";
import { openGeckoDialogWindow } from "../../../platform/gecko";
import type {
  SidebarActions,
  SidebarState,
  SidebarStreamingSnapshot,
} from "../ui/types";
import { createZopilotDeckHost, type ZopilotDeckHost } from "./deckHost";

const DETACHED_CHAT_WINDOW_HOST_ID = "zopilot-detached-window-host";
const DETACHED_CHAT_WINDOW_URI =
  "chrome://zopilot/content/detached-chat-window.xhtml";
const DETACHED_CHAT_WINDOW_FEATURES =
  "chrome,dialog=no,resizable,centerscreen,width=980,height=760";
const DETACHED_CHAT_WINDOW_MOUNT_RETRY_MS = 25;
const DETACHED_CHAT_WINDOW_MOUNT_TIMEOUT_MS = 5_000;
const logger = createLogger("sidebar.detachedWindow");

type DetachedChatWindowOptions = {
  createHost?: (
    panel: Element,
    portalHost: Element,
  ) => Promise<ZopilotDeckHost>;
  onClose?: () => void;
  onReady?: () => void;
  openWindow?: () => Window | null;
  onWarning?: (message: string, error?: unknown) => void;
};

class DetachedChatWindow {
  private chatWindow?: Window;
  private host?: ZopilotDeckHost;
  private hostCreation?: Promise<void>;
  private cancelMountRetry?: () => void;
  private mountDeadline = 0;
  private state?: SidebarState;
  private actions?: SidebarActions;
  private streamingSnapshot?: SidebarStreamingSnapshot;
  private ready = false;
  private destroyed = false;

  constructor(
    private readonly ownerWindow: Window,
    private readonly options: DetachedChatWindowOptions = {},
  ) {}

  isOpen(): boolean {
    return Boolean(this.chatWindow && !this.chatWindow.closed);
  }

  open(): void {
    if (this.destroyed) return;
    const existing = this.chatWindow;
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    this.clearMountRetry();
    this.releaseHost();
    this.chatWindow = undefined;
    this.ready = false;

    let chatWindow: Window | null;
    try {
      chatWindow = (this.options.openWindow || (() => this.openDialog()))();
    } catch (error) {
      this.warn("failed to open the detached Zopilot window", error);
      return;
    }
    if (!chatWindow) {
      this.warn("the detached Zopilot window API is unavailable");
      return;
    }

    this.chatWindow = chatWindow;
    chatWindow.addEventListener("load", () => this.tryMount(chatWindow), {
      once: true,
    });
    this.mountDeadline = Date.now() + DETACHED_CHAT_WINDOW_MOUNT_TIMEOUT_MS;
    this.tryMount(chatWindow);
    chatWindow.focus();
  }

  close(): void {
    const chatWindow = this.chatWindow;
    if (!chatWindow) return;
    try {
      if (!chatWindow.closed) chatWindow.close();
    } catch (error) {
      this.warn("failed to close the detached Zopilot window", error);
    }
    if (this.chatWindow === chatWindow) {
      this.handleWindowUnload(chatWindow);
    }
  }

  render(state: SidebarState, actions: SidebarActions): void {
    this.state = state;
    this.actions = actions;
    this.host?.render(state, actions);
  }

  publishStreaming(snapshot: SidebarStreamingSnapshot | undefined): void {
    this.streamingSnapshot = snapshot;
    this.host?.publishStreaming(snapshot);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.close();
    this.releaseHost();
    this.state = undefined;
    this.actions = undefined;
    this.streamingSnapshot = undefined;
  }

  private openDialog(): Window | null {
    return openGeckoDialogWindow(
      this.ownerWindow,
      DETACHED_CHAT_WINDOW_URI,
      "_blank",
      DETACHED_CHAT_WINDOW_FEATURES,
    );
  }

  private tryMount(chatWindow: Window): void {
    if (
      this.destroyed ||
      this.chatWindow !== chatWindow ||
      chatWindow.closed ||
      this.host ||
      this.hostCreation
    ) {
      this.clearMountRetry();
      return;
    }
    if (
      chatWindow.document.getElementById(DETACHED_CHAT_WINDOW_HOST_ID)
        ?.isConnected
    ) {
      this.clearMountRetry();
      this.mount(chatWindow);
      return;
    }
    if (Date.now() >= this.mountDeadline) {
      this.clearMountRetry();
      this.warn("the detached Zopilot window host is unavailable");
      this.close();
      return;
    }
    this.scheduleMountRetry(chatWindow);
  }

  private scheduleMountRetry(chatWindow: Window): void {
    if (this.cancelMountRetry) return;
    const retry = () => {
      this.cancelMountRetry = undefined;
      this.tryMount(chatWindow);
    };
    if (typeof this.ownerWindow.setTimeout === "function") {
      const timer = this.ownerWindow.setTimeout(
        retry,
        DETACHED_CHAT_WINDOW_MOUNT_RETRY_MS,
      );
      this.cancelMountRetry = () => this.ownerWindow.clearTimeout(timer);
      return;
    }
    const timer = globalThis.setTimeout(
      retry,
      DETACHED_CHAT_WINDOW_MOUNT_RETRY_MS,
    );
    this.cancelMountRetry = () => globalThis.clearTimeout(timer);
  }

  private clearMountRetry(): void {
    this.cancelMountRetry?.();
    this.cancelMountRetry = undefined;
  }

  private mount(chatWindow: Window): void {
    if (
      this.destroyed ||
      this.chatWindow !== chatWindow ||
      chatWindow.closed ||
      this.host ||
      this.hostCreation
    ) {
      return;
    }
    const panel = chatWindow.document.getElementById(
      DETACHED_CHAT_WINDOW_HOST_ID,
    );
    const portalHost = chatWindow.document.documentElement;
    if (!panel?.isConnected || !portalHost?.isConnected) {
      this.warn("the detached Zopilot window host is unavailable");
      this.close();
      return;
    }
    chatWindow.addEventListener(
      "unload",
      () => this.handleWindowUnload(chatWindow),
      { once: true },
    );
    this.hostCreation = this.createHost(panel, portalHost).finally(() => {
      this.hostCreation = undefined;
    });
  }

  private async createHost(panel: Element, portalHost: Element): Promise<void> {
    let host: ZopilotDeckHost;
    try {
      host = await (this.options.createHost || createDetachedHost)(
        panel,
        portalHost,
      );
    } catch (error) {
      this.warn("failed to mount the detached Zopilot window", error);
      this.close();
      return;
    }
    const chatWindow = this.chatWindow;
    if (
      this.destroyed ||
      !chatWindow ||
      chatWindow.closed ||
      panel.ownerDocument !== chatWindow.document
    ) {
      host.destroy();
      return;
    }
    this.host = host;
    host.publishStreaming(this.streamingSnapshot);
    if (this.state && this.actions) {
      host.render(this.state, this.actions);
    }
    this.ready = true;
    this.options.onReady?.();
  }

  private handleWindowUnload(chatWindow: Window): void {
    if (this.chatWindow !== chatWindow) return;
    const wasReady = this.ready;
    this.ready = false;
    this.chatWindow = undefined;
    this.clearMountRetry();
    this.releaseHost();
    if (wasReady && !this.destroyed) {
      this.options.onClose?.();
    }
  }

  private releaseHost(): void {
    const host = this.host;
    this.host = undefined;
    if (!host) return;
    try {
      host.destroy();
    } catch (error) {
      this.warn("failed to release the detached Zopilot window", error);
    }
  }

  private warn(message: string, error?: unknown): void {
    if (this.options.onWarning) {
      this.options.onWarning(message, error);
      return;
    }
    logger.warn(message, error);
  }
}

function createDetachedHost(
  panel: Element,
  portalHost: Element,
): Promise<ZopilotDeckHost> {
  return createZopilotDeckHost(panel, {
    portalHost,
    presentation: "window",
  });
}

export {
  DETACHED_CHAT_WINDOW_FEATURES,
  DETACHED_CHAT_WINDOW_HOST_ID,
  DETACHED_CHAT_WINDOW_URI,
  DetachedChatWindow,
};
export type { DetachedChatWindowOptions };
