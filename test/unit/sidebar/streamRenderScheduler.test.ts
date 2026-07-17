import { assert } from "chai";
import type { RunningTurnSnapshot } from "../../../src/domain/agent/streaming.ts";
import { StreamRenderScheduler } from "../../../src/features/sidebar/chat/StreamRenderScheduler.ts";

describe("stream render scheduler", function () {
  it("publishes ordinary snapshots adaptively with a 50ms minimum interval", function () {
    const clock = new SchedulerClock();
    let activeConversationId = "conv-a";
    let stateVersion = 1;
    const publications: Array<{ at: number; stateVersion: number }> = [];
    const scheduler = new StreamRenderScheduler({
      win: clock as unknown as Window,
      now: () => clock.now,
      getActiveConversationId: () => activeConversationId,
      getSnapshot: () => createSnapshot(stateVersion),
      publish: (snapshot) => {
        if (snapshot) {
          publications.push({
            at: snapshot.publishedAt,
            stateVersion: snapshot.stateVersion,
          });
        }
      },
    });

    scheduler.markDirty("conv-a");
    clock.flushFrames();
    assert.deepEqual(publications, [{ at: 0, stateVersion: 1 }]);

    clock.advance(10);
    stateVersion = 2;
    scheduler.markDirty("conv-a");
    stateVersion = 3;
    scheduler.markDirty("conv-a");
    assert.equal(clock.pendingFrames, 0);
    assert.equal(clock.pendingTimers, 1);

    clock.advance(40);
    clock.flushFrames();
    assert.deepEqual(publications, [
      { at: 0, stateVersion: 1 },
      { at: 50, stateVersion: 3 },
    ]);

    clock.advance(100);
    stateVersion = 4;
    scheduler.markDirty("conv-a");
    assert.equal(clock.pendingFrames, 1);
    clock.flushFrames();
    assert.equal(publications.at(-1)?.at, 150);

    activeConversationId = "conv-b";
    stateVersion = 5;
    scheduler.markDirty("conv-a");
    assert.equal(clock.pendingFrames, 0);
  });

  it("lets immediate lifecycle updates bypass the ordinary 20fps cap", function () {
    const clock = new SchedulerClock();
    const publishedAt: number[] = [];
    const scheduler = new StreamRenderScheduler({
      win: clock as unknown as Window,
      now: () => clock.now,
      getActiveConversationId: () => "conv-a",
      getSnapshot: () => createSnapshot(1),
      publish: (snapshot) => {
        if (snapshot) publishedAt.push(snapshot.publishedAt);
      },
    });

    scheduler.markDirty("conv-a");
    clock.flushFrames();
    clock.advance(10);
    scheduler.markDirty("conv-a", { immediate: true });
    clock.flushFrames();

    assert.deepEqual(publishedAt, [0, 10]);
  });

  it("leaves no scheduled work after destroy", function () {
    const clock = new SchedulerClock();
    const scheduler = new StreamRenderScheduler({
      win: clock as unknown as Window,
      now: () => clock.now,
      getActiveConversationId: () => "conv-a",
      getSnapshot: () => createSnapshot(1),
      publish: () => undefined,
    });

    scheduler.markDirty("conv-a");
    clock.flushFrames();
    clock.advance(10);
    scheduler.markDirty("conv-a");
    assert.equal(clock.pendingTimers, 1);

    scheduler.destroy();
    assert.equal(clock.pendingFrames, 0);
    assert.equal(clock.pendingTimers, 0);
  });
});

function createSnapshot(stateVersion: number): RunningTurnSnapshot {
  return {
    conversationId: "conv-a",
    messageId: "assistant-a",
    lifecycle: "running",
    stateVersion,
    sequence: stateVersion,
    finalStarted: false,
    answerBlocks: [],
    traceBlocks: [],
  };
}

class SchedulerClock {
  now = 0;
  private nextId = 1;
  private readonly frames = new Map<number, FrameRequestCallback>();
  private readonly timers = new Map<
    number,
    { callback: TimerHandler; dueAt: number }
  >();

  get pendingFrames(): number {
    return this.frames.size;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.frames.delete(id);
  }

  setTimeout(callback: TimerHandler, delay = 0): number {
    const id = this.nextId++;
    this.timers.set(id, {
      callback,
      dueAt: this.now + Number(delay),
    });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      if (typeof due[1].callback === "function") due[1].callback();
    }
  }

  flushFrames(): void {
    const frames = [...this.frames.values()];
    this.frames.clear();
    for (const frame of frames) frame(this.now);
  }
}
