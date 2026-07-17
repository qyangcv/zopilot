import type { RunningTurnSnapshot } from "../../../domain/agent/streaming";
import type { SidebarStreamingSnapshot } from "../ui/types";

const MIN_PUBLISH_INTERVAL_MS = 50;
const TOOL_CLOCK_INTERVAL_MS = 250;

type StreamRenderSchedulerOptions = {
  getActiveConversationId: () => string | undefined;
  getSnapshot: (conversationId: string) => RunningTurnSnapshot | undefined;
  now?: () => number;
  publish: (snapshot: SidebarStreamingSnapshot | undefined) => void;
  win: Window;
};

class StreamRenderScheduler {
  private activeDirty = false;
  private delayTimer?: number;
  private destroyed = false;
  private forceImmediate = false;
  private frame?: number;
  private lastOrdinaryPublishedAt = Number.NEGATIVE_INFINITY;
  private publicationVersion = 0;
  private toolClockTimer?: number;
  private visible = true;

  constructor(private readonly options: StreamRenderSchedulerOptions) {}

  markDirty(
    conversationId: string,
    options: { immediate?: boolean } = {},
  ): void {
    if (
      this.destroyed ||
      !this.visible ||
      this.options.getActiveConversationId() !== conversationId
    ) {
      return;
    }
    this.activeDirty = true;
    this.forceImmediate ||= Boolean(options.immediate);
    if (this.forceImmediate) this.cancelDelayTimer();
    this.schedule();
  }

  publishActive(): void {
    if (this.destroyed || !this.visible) return;
    this.activeDirty = true;
    this.forceImmediate = true;
    this.lastOrdinaryPublishedAt = Number.NEGATIVE_INFINITY;
    this.cancelDelayTimer();
    this.schedule();
  }

  clear(): void {
    if (this.destroyed) return;
    this.activeDirty = false;
    this.forceImmediate = false;
    this.cancelFrame();
    this.cancelDelayTimer();
    this.cancelToolClock();
    this.options.publish(undefined);
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.clearScheduledWork();
      this.options.publish(undefined);
      return;
    }
    this.publishActive();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearScheduledWork();
    this.options.publish(undefined);
  }

  private schedule(): void {
    if (!this.activeDirty || this.frame !== undefined || this.destroyed) return;
    const elapsed = this.now() - this.lastOrdinaryPublishedAt;
    if (!this.forceImmediate && elapsed < MIN_PUBLISH_INTERVAL_MS) {
      this.scheduleDelay(MIN_PUBLISH_INTERVAL_MS - elapsed);
      return;
    }
    let completedSynchronously = false;
    let frame = 0;
    frame = this.options.win.requestAnimationFrame(() => {
      completedSynchronously = true;
      this.frame = undefined;
      this.flushFrame();
    });
    if (!completedSynchronously) this.frame = frame;
  }

  private flushFrame(): void {
    if (this.destroyed || !this.visible || !this.activeDirty) {
      return;
    }
    if (!this.options.getActiveConversationId()) {
      this.activeDirty = false;
      this.forceImmediate = false;
      this.cancelToolClock();
      this.options.publish(undefined);
      return;
    }
    const now = this.now();
    const elapsed = now - this.lastOrdinaryPublishedAt;
    if (!this.forceImmediate && elapsed < MIN_PUBLISH_INTERVAL_MS) {
      this.scheduleDelay(MIN_PUBLISH_INTERVAL_MS - elapsed);
      return;
    }

    const conversationId = this.options.getActiveConversationId();
    if (!conversationId) return;
    const snapshot = this.options.getSnapshot(conversationId);
    const immediate = this.forceImmediate;
    this.activeDirty = false;
    this.forceImmediate = false;
    if (!immediate) this.lastOrdinaryPublishedAt = now;
    this.options.publish(
      snapshot
        ? {
            ...snapshot,
            publicationVersion: ++this.publicationVersion,
            publishedAt: now,
          }
        : undefined,
    );

    if (snapshot?.hasRunningTools) this.ensureToolClock();
    else this.cancelToolClock();
    if (this.activeDirty) this.schedule();
  }

  private scheduleDelay(delayMs: number): void {
    if (this.delayTimer !== undefined || this.destroyed) return;
    this.delayTimer = this.options.win.setTimeout(
      () => {
        this.delayTimer = undefined;
        this.schedule();
      },
      Math.max(0, Math.ceil(delayMs)),
    );
  }

  private ensureToolClock(): void {
    if (this.toolClockTimer !== undefined || this.destroyed || !this.visible) {
      return;
    }
    this.toolClockTimer = this.options.win.setTimeout(() => {
      this.toolClockTimer = undefined;
      const conversationId = this.options.getActiveConversationId();
      if (!conversationId) return;
      const snapshot = this.options.getSnapshot(conversationId);
      if (!snapshot?.hasRunningTools) return;
      this.markDirty(conversationId, { immediate: true });
      this.ensureToolClock();
    }, TOOL_CLOCK_INTERVAL_MS);
  }

  private clearScheduledWork(): void {
    this.activeDirty = false;
    this.forceImmediate = false;
    this.cancelFrame();
    this.cancelDelayTimer();
    this.cancelToolClock();
  }

  private cancelFrame(): void {
    if (this.frame === undefined) return;
    this.options.win.cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  private cancelDelayTimer(): void {
    if (this.delayTimer === undefined) return;
    this.options.win.clearTimeout(this.delayTimer);
    this.delayTimer = undefined;
  }

  private cancelToolClock(): void {
    if (this.toolClockTimer === undefined) return;
    this.options.win.clearTimeout(this.toolClockTimer);
    this.toolClockTimer = undefined;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

export { StreamRenderScheduler };
export type { StreamRenderSchedulerOptions };
