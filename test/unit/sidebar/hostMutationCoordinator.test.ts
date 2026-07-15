import { assert } from "chai";
import {
  HostMutationCoordinator,
  collectHostChainTargets,
} from "../../../src/features/sidebar/host/HostMutationCoordinator.ts";

describe("HostMutationCoordinator", function () {
  it("observes host ancestors but never the plugin message subtree", function () {
    const root = element(undefined);
    const zoteroPane = element(root);
    const hostDeck = element(zoteroPane);
    const pluginPanel = element(hostDeck);
    const messageRoot = element(pluginPanel);

    const targets = collectHostChainTargets([hostDeck]);

    assert.includeMembers(targets, [root, zoteroPane, hostDeck]);
    assert.notInclude(targets, pluginPanel);
    assert.notInclude(targets, messageRoot);
  });

  it("coalesces observer work to one frame and cancels it on destroy", function () {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let observerCallback: MutationCallback | undefined;
    let disconnectCount = 0;
    const win = {
      MutationObserver: class {
        constructor(callback: MutationCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {
          disconnectCount++;
        }
      },
      requestAnimationFrame(callback: FrameRequestCallback) {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id: number) {
        frames.delete(id);
      },
    } as unknown as Window;
    let reconciles = 0;
    const coordinator = new HostMutationCoordinator(win, {
      getTargets: () => ({ attributes: [], childList: [] }),
      reconcile: () => reconciles++,
    });
    coordinator.mount();

    observerCallback?.([], {} as MutationObserver);
    observerCallback?.([], {} as MutationObserver);
    observerCallback?.([], {} as MutationObserver);
    assert.equal(frames.size, 1);

    const frame = [...frames.values()][0];
    frames.clear();
    frame(0);
    assert.equal(reconciles, 1);

    coordinator.schedule();
    assert.equal(frames.size, 1);
    coordinator.destroy();
    assert.equal(frames.size, 0);
    assert.isAtLeast(disconnectCount, 2);
  });
});

function element(parentElement?: Element): Element {
  return {
    isConnected: true,
    parentElement: parentElement || null,
  } as Element;
}
