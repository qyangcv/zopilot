type HostMutationTargets = {
  childList: Element[];
  attributes: Array<{
    element: Element;
    names: string[];
  }>;
};

type HostMutationCoordinatorOptions = {
  getTargets: () => HostMutationTargets;
  reconcile: () => void;
};

/**
 * Observes only the Zotero-owned host chain. Plugin message content is never an
 * observation target, so streamed React mutations cannot schedule host work.
 */
class HostMutationCoordinator {
  private readonly observer: MutationObserver;
  private frame?: number;
  private destroyed = false;

  constructor(
    private readonly win: Window,
    private readonly options: HostMutationCoordinatorOptions,
  ) {
    this.observer = new win.MutationObserver(() => this.schedule());
  }

  mount(): void {
    if (this.destroyed) return;
    this.refreshTargets();
  }

  refreshTargets(): void {
    if (this.destroyed) return;
    this.observer.disconnect();
    const targets = this.options.getTargets();
    const childListTargets = collectHostChainTargets(targets.childList);
    childListTargets.forEach((element) => {
      this.observer.observe(element, { childList: true });
    });
    targets.attributes.forEach(({ element, names }) => {
      if (!element.isConnected || names.length === 0) return;
      this.observer.observe(element, {
        attributes: true,
        attributeFilter: names,
      });
    });
  }

  schedule(): void {
    if (this.destroyed || this.frame !== undefined) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = undefined;
      if (this.destroyed) return;
      this.options.reconcile();
      this.refreshTargets();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    if (this.frame !== undefined) {
      this.win.cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
  }
}

function collectHostChainTargets(anchors: Element[]): Element[] {
  const targets = new Set<Element>();
  for (const anchor of anchors) {
    if (!anchor.isConnected) continue;
    let current: Element | null = anchor;
    while (current) {
      targets.add(current);
      current = current.parentElement;
    }
  }
  return [...targets];
}

export { HostMutationCoordinator, collectHostChainTargets };
export type { HostMutationTargets };
