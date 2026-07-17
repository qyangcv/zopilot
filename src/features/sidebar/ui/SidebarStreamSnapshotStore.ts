import type { SidebarStreamingSnapshot } from "./types";

type SnapshotListener = () => void;

class SidebarStreamSnapshotStore {
  private snapshot: SidebarStreamingSnapshot | undefined;
  private readonly listeners = new Set<SnapshotListener>();

  getSnapshot = (): SidebarStreamingSnapshot | undefined => this.snapshot;

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(next: SidebarStreamingSnapshot | undefined): void {
    if (!next) {
      if (!this.snapshot) return;
      this.snapshot = undefined;
      this.notify();
      return;
    }

    const previous =
      this.snapshot?.conversationId === next.conversationId
        ? this.snapshot
        : undefined;
    this.snapshot = {
      ...next,
      answerBlocks: reuseBlocks(previous?.answerBlocks, next.answerBlocks),
      traceBlocks: reuseBlocks(previous?.traceBlocks, next.traceBlocks),
    };
    this.notify();
  }

  clear(): void {
    this.publish(undefined);
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function reuseBlocks<Block extends { id: string; revision: number }>(
  previous: readonly Block[] | undefined,
  next: readonly Block[],
): readonly Block[] {
  if (!previous) return next;
  if (!previous.length && !next.length) return previous;
  if (!previous.length || !next.length) return next;
  const previousById = new Map(previous.map((block) => [block.id, block]));
  let changed = previous.length !== next.length;
  const reused = next.map((block, index) => {
    const old = previousById.get(block.id);
    const value = old?.revision === block.revision ? old : block;
    changed ||= value !== previous[index];
    return value;
  });
  return changed ? reused : previous;
}

export { SidebarStreamSnapshotStore };
