export type SidebarPerformanceMetricName =
  | "markdown.total"
  | "markdown.segment"
  | "markdown.parse"
  | "markdown.render"
  | "markdown.sanitize"
  | "markdown.shiki"
  | "markdown.shiki.cacheHit"
  | "markdown.katex"
  | "markdown.katex.cacheHit"
  | "markdown.reactCommit"
  | "markdown.domReplace"
  | "markdown.layout"
  | "scroll.sync";

export type SidebarPerformanceSample = {
  durationMs: number;
  textLength?: number;
};

export type SidebarPerformanceMetric = {
  averageMs: number;
  count: number;
  maxMs: number;
  samples: SidebarPerformanceSample[];
  totalMs: number;
};

export type SidebarPerformanceReport = Partial<
  Record<SidebarPerformanceMetricName, SidebarPerformanceMetric>
>;

type MutableMetric = {
  count: number;
  maxMs: number;
  samples: SidebarPerformanceSample[];
  totalMs: number;
};

const MAX_SAMPLES_PER_METRIC = 200;

let enabled = false;
const metrics = new Map<SidebarPerformanceMetricName, MutableMetric>();

export function setSidebarPerformanceMetricsEnabled(
  nextEnabled: boolean,
): void {
  enabled = nextEnabled;
  if (nextEnabled) resetSidebarPerformanceMetrics();
}

export function resetSidebarPerformanceMetrics(): void {
  metrics.clear();
}

export function beginSidebarPerformanceMeasure(
  name: SidebarPerformanceMetricName,
  details: { textLength?: number } = {},
): (() => void) | undefined {
  if (!enabled) return undefined;
  const startedAt = now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    recordSidebarPerformanceMetric(name, now() - startedAt, details);
  };
}

export function measureSidebarPerformance<T>(
  name: SidebarPerformanceMetricName,
  details: { textLength?: number },
  operation: () => T,
): T {
  const finish = beginSidebarPerformanceMeasure(name, details);
  try {
    return operation();
  } finally {
    finish?.();
  }
}

export function recordSidebarPerformanceMetric(
  name: SidebarPerformanceMetricName,
  durationMs: number,
  details: { textLength?: number } = {},
): void {
  if (!enabled) return;
  const metric = metrics.get(name) ?? {
    count: 0,
    maxMs: 0,
    samples: [],
    totalMs: 0,
  };
  const normalizedDuration = Math.max(0, durationMs);
  metric.count += 1;
  metric.totalMs += normalizedDuration;
  metric.maxMs = Math.max(metric.maxMs, normalizedDuration);
  metric.samples.push({
    durationMs: normalizedDuration,
    ...(details.textLength === undefined
      ? {}
      : { textLength: details.textLength }),
  });
  if (metric.samples.length > MAX_SAMPLES_PER_METRIC) {
    metric.samples.shift();
  }
  metrics.set(name, metric);
}

export function getSidebarPerformanceReport(): SidebarPerformanceReport {
  return Object.fromEntries(
    [...metrics.entries()].map(([name, metric]) => [
      name,
      {
        averageMs: metric.count === 0 ? 0 : metric.totalMs / metric.count,
        count: metric.count,
        maxMs: metric.maxMs,
        samples: metric.samples.map((sample) => ({ ...sample })),
        totalMs: metric.totalMs,
      },
    ]),
  ) as SidebarPerformanceReport;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}
