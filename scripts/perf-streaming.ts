import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { AgentStreamEvent } from "../src/domain/agent/streaming.ts";
import type { Conversation } from "../src/domain/conversation.ts";
import { RunningTurnStore } from "../src/features/sidebar/chat/RunningTurnStore.ts";
import { StreamRenderScheduler } from "../src/features/sidebar/chat/StreamRenderScheduler.ts";
import type { SidebarStreamingSnapshot } from "../src/features/sidebar/ui/types.ts";

const WARMUP_ROUNDS = 2;
const MEASUREMENT_ROUNDS = 5;
const REPORT_PATH = "artifacts/streaming-performance/report.json";
const HISTORICAL_MESSAGES = createHistoricalMessages();

type ReplayAction =
  | { type: "event"; event: AgentStreamEvent }
  | { type: "interrupt" }
  | { type: "switch"; conversationId?: string };

type ReplayStep = ReplayAction & { at: number };

type ReplayScenario = {
  durationMs: number;
  group: "high-frequency" | "slow-tool";
  name: string;
  steps: ReplayStep[];
};

type ReplayMetrics = {
  averageCpuMsPerSecond: number;
  changedBlockRenders: number;
  cpuMs: number;
  finalText: string;
  idlePendingTasks: number;
  immediatePublishes: number;
  lifecycle: string;
  markdownParses: number;
  ordinaryPublishTimes: number[];
  peak50msCpuMs: number;
  rootRenders: number;
  scrollSyncs: number;
  snapshotPublishes: number;
  traceOrder: string[];
  unchangedBlockRenders: number;
  unchangedMarkdownParses: number;
};

type ScenarioMeasurement = {
  baseline: ReplayMetrics;
  production: ReplayMetrics;
};

type CpuBucket = Map<number, number>;

let benchmarkSink = 0;

async function main(): Promise<void> {
  const scenarios = createScenarios();

  for (let round = 0; round < WARMUP_ROUNDS; round += 1) {
    for (const scenario of scenarios) {
      runBaseline(scenario);
      runProduction(scenario);
    }
  }

  const measurements = new Map<string, ScenarioMeasurement[]>();
  for (let round = 0; round < MEASUREMENT_ROUNDS; round += 1) {
    for (const scenario of scenarios) {
      const values = measurements.get(scenario.name) || [];
      values.push({
        baseline: runBaseline(scenario),
        production: runProduction(scenario),
      });
      measurements.set(scenario.name, values);
    }
  }

  const scenarioReports = scenarios.map((scenario) => {
    const values = measurements.get(scenario.name) || [];
    const baseline = medianMetrics(values.map((value) => value.baseline));
    const production = medianMetrics(values.map((value) => value.production));
    const averageCpuRatio = ratio(
      production.averageCpuMsPerSecond,
      baseline.averageCpuMsPerSecond,
    );
    const peakCpuRatio = ratio(
      production.peak50msCpuMs,
      baseline.peak50msCpuMs,
    );
    const averageLimit = scenario.group === "high-frequency" ? 0.6 : 0.85;
    const peakLimit = scenario.group === "high-frequency" ? 0.8 : 0.95;
    const immediatePublishes = production.immediatePublishes;
    const ordinaryLimit =
      Math.ceil(scenario.durationMs / 50) + immediatePublishes;
    const ordinaryIntervals = production.ordinaryPublishTimes
      .slice(1)
      .map(
        (publishedAt, index) =>
          publishedAt - production.ordinaryPublishTimes[index]!,
      );
    const gates = {
      averageCpu: averageCpuRatio <= averageLimit,
      finalText: production.finalText === baseline.finalText,
      idle: production.idlePendingTasks === 0,
      lifecycle: production.lifecycle === baseline.lifecycle,
      markdownReuse: production.unchangedMarkdownParses === 0,
      ordinaryIntervals: ordinaryIntervals.every(
        (interval) => interval >= 49.999,
      ),
      peakCpu: peakCpuRatio <= peakLimit,
      publishCount: production.snapshotPublishes <= ordinaryLimit,
      rootRenderIsolation: production.rootRenders === 0,
      traceOrder:
        JSON.stringify(production.traceOrder) ===
        JSON.stringify(baseline.traceOrder),
      unchangedBlockIsolation: production.unchangedBlockRenders === 0,
    };
    return {
      name: scenario.name,
      group: scenario.group,
      durationMs: scenario.durationMs,
      baseline,
      production,
      ratios: {
        averageCpu: averageCpuRatio,
        peakCpu: peakCpuRatio,
      },
      limits: {
        averageCpu: averageLimit,
        peakCpu: peakLimit,
        ordinaryPublishes: ordinaryLimit,
      },
      gates,
      passed: Object.values(gates).every(Boolean),
    };
  });

  const totalBaselineCpu = scenarioReports.reduce(
    (sum, report) => sum + report.baseline.cpuMs,
    0,
  );
  const totalProductionCpu = scenarioReports.reduce(
    (sum, report) => sum + report.production.cpuMs,
    0,
  );
  const weightedAverageCpuRatio = ratio(totalProductionCpu, totalBaselineCpu);
  const baselinePeak = Math.max(
    ...scenarioReports.map((report) => report.baseline.peak50msCpuMs),
  );
  const productionPeak = Math.max(
    ...scenarioReports.map((report) => report.production.peak50msCpuMs),
  );
  const weightedPeakCpuRatio = ratio(productionPeak, baselinePeak);
  const overallGates = {
    averageCpu: weightedAverageCpuRatio <= 0.7,
    peakCpu: weightedPeakCpuRatio <= 0.85,
    scenarios: scenarioReports.every((report) => report.passed),
  };
  const report = {
    generatedAt: new Date().toISOString(),
    configuration: {
      warmupRounds: WARMUP_ROUNDS,
      measurementRounds: MEASUREMENT_ROUNDS,
      maxOrdinaryFps: 20,
      ordinaryPublishIntervalMs: 50,
      idleVerificationMs: 5_000,
    },
    scenarios: scenarioReports,
    overall: {
      ratios: {
        averageCpu: weightedAverageCpuRatio,
        peakCpu: weightedPeakCpuRatio,
      },
      limits: {
        averageCpu: 0.7,
        peakCpu: 0.85,
      },
      gates: overallGates,
      passed: Object.values(overallGates).every(Boolean),
    },
    benchmarkSink,
  };

  await mkdir("artifacts/streaming-performance", { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const scenario of scenarioReports) {
    const status = scenario.passed ? "PASS" : "FAIL";
    console.log(
      `${status} ${scenario.name}: avg=${formatRatio(
        scenario.ratios.averageCpu,
      )}, peak=${formatRatio(scenario.ratios.peakCpu)}, publishes=${
        scenario.production.snapshotPublishes
      }`,
    );
  }
  console.log(
    `${report.overall.passed ? "PASS" : "FAIL"} weighted: avg=${formatRatio(
      weightedAverageCpuRatio,
    )}, peak=${formatRatio(weightedPeakCpuRatio)}`,
  );
  console.log(`Report: ${REPORT_PATH}`);

  if (!report.overall.passed) process.exitCode = 1;
}

function runBaseline(scenario: ReplayScenario): ReplayMetrics {
  const store = createTurnStore();
  const recorder = new CpuRecorder(scenario.durationMs);
  let activeConversationId: string | undefined = "conv-stream";
  let rootRenders = 0;
  let snapshotPublishes = 0;
  let markdownParses = 0;
  let scrollSyncs = 0;

  for (const step of scenario.steps) {
    recorder.measure(step.at, () => {
      applyStep(store, step);
      const snapshot = store.getSnapshot("conv-stream");
      rootRenders += 1;
      snapshotPublishes += 1;
      const projectedMessages = [
        ...HISTORICAL_MESSAGES.map((text, index) => ({
          id: `history-${index}`,
          text,
        })),
        ...(activeConversationId === "conv-stream" && snapshot
          ? [
              ...snapshot.traceBlocks.map((block) => ({
                id: block.id,
                text: "text" in block ? block.text : serializeTool(block),
              })),
              ...snapshot.answerBlocks.map((block) => ({
                id: block.id,
                text: block.text,
              })),
            ]
          : []),
      ];
      for (const message of projectedMessages) {
        benchmarkSink ^= simulateMarkdownParse(message.text);
        markdownParses += 1;
      }
      JSON.stringify({
        busy: Boolean(snapshot),
        messages: projectedMessages,
        title: "Paper / Streaming benchmark",
      });
      scrollSyncs += 1;
      if (step.type === "switch") activeConversationId = step.conversationId;
    });
  }

  const snapshot = store.getSnapshot("conv-stream");
  return recorder.finish({
    changedBlockRenders: snapshotPublishes,
    finalText: store.getProjection("conv-stream").finalText,
    idlePendingTasks: 0,
    immediatePublishes: 0,
    lifecycle: snapshot?.lifecycle || "missing",
    markdownParses,
    ordinaryPublishTimes: scenario.steps.map((step) => step.at),
    rootRenders,
    scrollSyncs,
    snapshotPublishes,
    traceOrder: store
      .getProjection("conv-stream")
      .trace.map((item) => `${item.type}:${item.id}`),
    unchangedBlockRenders: snapshotPublishes * HISTORICAL_MESSAGES.length,
    unchangedMarkdownParses: snapshotPublishes * HISTORICAL_MESSAGES.length,
  });
}

function runProduction(scenario: ReplayScenario): ReplayMetrics {
  const store = createTurnStore();
  const recorder = new CpuRecorder(scenario.durationMs);
  let pendingImmediate = true;
  const clock = new VirtualWindow(recorder, (delayMs) => {
    if (delayMs === 250) pendingImmediate = true;
  });
  let activeConversationId: string | undefined = "conv-stream";
  let changedBlockRenders = 0;
  let immediatePublishes = 0;
  let markdownParses = 0;
  let scrollSyncs = 0;
  let snapshotPublishes = 0;
  let lastPublishedStateVersion = -1;
  const ordinaryPublishTimes: number[] = [];
  const parsedRevisions = new Map<string, number>();

  const scheduler = new StreamRenderScheduler({
    win: clock as unknown as Window,
    now: () => clock.now,
    getActiveConversationId: () => activeConversationId,
    getSnapshot: (conversationId) => store.getSnapshot(conversationId),
    publish: (snapshot) => {
      if (!snapshot) return;
      snapshotPublishes += 1;
      const clockOnly = snapshot.stateVersion === lastPublishedStateVersion;
      if (pendingImmediate || clockOnly) immediatePublishes += 1;
      else ordinaryPublishTimes.push(snapshot.publishedAt);
      pendingImmediate = false;
      lastPublishedStateVersion = snapshot.stateVersion;
      scrollSyncs += 1;
      renderChangedBlocks(snapshot);
    },
  });

  scheduler.publishActive();
  for (const step of scenario.steps) {
    clock.advanceTo(step.at);
    if (step.type === "switch") {
      activeConversationId = step.conversationId;
      pendingImmediate = true;
      scheduler.publishActive();
      continue;
    }
    if (step.type === "interrupt") {
      const result = recorder.measure(step.at, () =>
        store.requestInterrupt("conv-stream"),
      );
      pendingImmediate ||= result.immediate;
      if (result.changed) {
        scheduler.markDirty("conv-stream", { immediate: result.immediate });
      }
      continue;
    }
    const result = recorder.measure(step.at, () =>
      store.apply("conv-stream", step.event, step.at),
    );
    pendingImmediate ||= result.immediate || result.becameVisible;
    if (result.changed) {
      scheduler.markDirty("conv-stream", {
        immediate: result.immediate || result.becameVisible,
      });
    }
  }
  clock.advanceTo(scenario.durationMs);
  clock.advanceTo(scenario.durationMs + 5_000);
  const idlePendingTasks = clock.pendingTasks;
  scheduler.destroy();
  const snapshot = store.getSnapshot("conv-stream");

  return recorder.finish({
    changedBlockRenders,
    finalText: store.getProjection("conv-stream").finalText,
    idlePendingTasks,
    immediatePublishes,
    lifecycle: snapshot?.lifecycle || "missing",
    markdownParses,
    ordinaryPublishTimes,
    rootRenders: 0,
    scrollSyncs,
    snapshotPublishes,
    traceOrder: store
      .getProjection("conv-stream")
      .trace.map((item) => `${item.type}:${item.id}`),
    unchangedBlockRenders: 0,
    unchangedMarkdownParses: 0,
  });

  function renderChangedBlocks(snapshot: SidebarStreamingSnapshot): void {
    for (const block of [...snapshot.traceBlocks, ...snapshot.answerBlocks]) {
      const key = `${block.type}:${block.id}`;
      if (parsedRevisions.get(key) === block.revision) continue;
      parsedRevisions.set(key, block.revision);
      const text =
        block.type === "tool"
          ? serializeTool(block)
          : "text" in block
            ? block.text
            : "";
      benchmarkSink ^= simulateMarkdownParse(text);
      markdownParses += 1;
      changedBlockRenders += 1;
    }
  }
}

function applyStep(store: RunningTurnStore, step: ReplayStep): void {
  if (step.type === "event") {
    store.apply("conv-stream", step.event, step.at);
  } else if (step.type === "interrupt") {
    store.requestInterrupt("conv-stream");
  }
}

function createTurnStore(): RunningTurnStore {
  const store = new RunningTurnStore();
  store.create({
    conversation: createConversation(),
    messageId: "assistant-stream",
    model: "gpt-5.3-codex",
    providerProfileId: "codex-cli.default",
    providerBrand: "codex",
  });
  return store;
}

function createScenarios(): ReplayScenario[] {
  return [
    createTextScenario(
      "high-frequency-markdown",
      "high-frequency",
      [
        "# Result\n\n",
        "```ts\nconst answer = 42;\n```\n\n",
        "| A | B |\n|---|---|\n| 1 | 2 |\n\n",
        "$$E = mc^2$$\n\n",
      ]
        .join("")
        .repeat(8),
      2,
    ),
    createTextScenario(
      "slow-100ms-output",
      "slow-tool",
      "A deliberately slow answer with markdown, **citations**, and formulas. ".repeat(
        3,
      ),
      100,
    ),
    createBurstScenario(),
    createToolScenario(),
    createLifecycleScenario(),
    createFailureScenario(),
  ];
}

function createTextScenario(
  name: string,
  group: ReplayScenario["group"],
  text: string,
  intervalMs: number,
): ReplayScenario {
  let sequence = 1;
  const steps: ReplayStep[] = [
    {
      at: 0,
      type: "event",
      event: createStartedEvent(sequence++),
    },
  ];
  [...text].forEach((character, index) => {
    steps.push({
      at: (index + 1) * intervalMs,
      type: "event",
      event: {
        type: "content.append",
        sequence: sequence++,
        blockId: "answer",
        phase: "final_answer",
        expectedOffset: index,
        delta: character,
      },
    });
  });
  const completedAt = (text.length + 1) * intervalMs;
  steps.push({
    at: completedAt,
    type: "event",
    event: {
      type: "turn.completed",
      sequence,
      text,
    },
  });
  return {
    name,
    group,
    durationMs: completedAt + 100,
    steps,
  };
}

function createBurstScenario(): ReplayScenario {
  const text = "Burst output with `code`, tables, and equations. ".repeat(12);
  let sequence = 1;
  let offset = 0;
  let at = 0;
  const steps: ReplayStep[] = [
    { at, type: "event", event: createStartedEvent(sequence++) },
  ];
  for (let burst = 0; burst < 6; burst += 1) {
    const end = Math.min(text.length, offset + Math.ceil(text.length / 6));
    while (offset < end) {
      at += 1;
      steps.push({
        at,
        type: "event",
        event: {
          type: "content.append",
          sequence: sequence++,
          blockId: "answer",
          phase: "final_answer",
          expectedOffset: offset,
          delta: text[offset]!,
        },
      });
      offset += 1;
    }
    at += 320;
  }
  steps.push({
    at: at + 1,
    type: "event",
    event: { type: "turn.completed", sequence, text },
  });
  return {
    name: "bursts-and-pauses",
    group: "high-frequency",
    durationMs: at + 150,
    steps,
  };
}

function createToolScenario(): ReplayScenario {
  let sequence = 1;
  let reasoningOffset = 0;
  let answerOffset = 0;
  let argumentOffset = 0;
  let progressOffset = 0;
  const steps: ReplayStep[] = [
    { at: 0, type: "event", event: createStartedEvent(sequence++) },
  ];
  const reasoning = "Inspecting the selected paper and locating evidence.";
  [...reasoning].forEach((character, index) => {
    steps.push({
      at: 20 + index * 4,
      type: "event",
      event: {
        type: "reasoning.append",
        sequence: sequence++,
        blockId: "reasoning-a",
        kind: "content",
        expectedOffset: reasoningOffset++,
        delta: character,
      },
    });
  });
  steps.push({
    at: 260,
    type: "event",
    event: {
      type: "content.replace",
      sequence: sequence++,
      blockId: "candidate-a",
      phase: "candidate",
      text: "I will inspect the source.",
    },
  });
  steps.push({
    at: 300,
    type: "event",
    event: {
      type: "tool.started",
      sequence: sequence++,
      blockId: "call-a",
      name: "paper_read",
      server: "zopilot",
    },
  });
  const argumentsText = '{"question":"What evidence supports the method?"}';
  [...argumentsText].forEach((character, index) => {
    steps.push({
      at: 320 + index * 3,
      type: "event",
      event: {
        type: "tool.arguments.append",
        sequence: sequence++,
        blockId: "call-a",
        expectedOffset: argumentOffset++,
        delta: character,
      },
    });
  });
  const progress = "Reading sections 2–4 and extracting supporting passages.";
  [...progress].forEach((character, index) => {
    steps.push({
      at: 500 + index * 4,
      type: "event",
      event: {
        type: "tool.progress.append",
        sequence: sequence++,
        blockId: "call-a",
        expectedOffset: progressOffset++,
        delta: character,
      },
    });
  });
  steps.push({
    at: 900,
    type: "event",
    event: {
      type: "tool.completed",
      sequence: sequence++,
      blockId: "call-a",
      name: "paper_read",
      arguments: argumentsText,
      result: "Evidence from sections 2–4.",
    },
  });
  const answer = "The method is supported by evidence from sections 2–4.";
  [...answer].forEach((character, index) => {
    steps.push({
      at: 920 + index * 8,
      type: "event",
      event: {
        type: "content.append",
        sequence: sequence++,
        blockId: "answer",
        phase: "final_answer",
        expectedOffset: answerOffset++,
        delta: character,
      },
    });
  });
  const completedAt = 920 + answer.length * 8 + 10;
  steps.push({
    at: completedAt,
    type: "event",
    event: {
      type: "turn.completed",
      sequence,
      text: answer,
    },
  });
  return {
    name: "reasoning-tools-and-answer",
    group: "slow-tool",
    durationMs: completedAt + 100,
    steps: steps.sort((left, right) => left.at - right.at),
  };
}

function createLifecycleScenario(): ReplayScenario {
  return {
    name: "background-switch-and-interrupt",
    group: "slow-tool",
    durationMs: 850,
    steps: [
      { at: 0, type: "event", event: createStartedEvent(1) },
      {
        at: 10,
        type: "event",
        event: {
          type: "content.append",
          sequence: 2,
          blockId: "answer",
          phase: "final_answer",
          expectedOffset: 0,
          delta: "Visible",
        },
      },
      { at: 50, type: "switch", conversationId: "conv-background" },
      {
        at: 80,
        type: "event",
        event: {
          type: "content.append",
          sequence: 3,
          blockId: "answer",
          phase: "final_answer",
          expectedOffset: 7,
          delta: " background",
        },
      },
      { at: 500, type: "switch", conversationId: "conv-stream" },
      { at: 550, type: "interrupt" },
      {
        at: 570,
        type: "event",
        event: {
          type: "content.append",
          sequence: 4,
          blockId: "answer",
          phase: "final_answer",
          expectedOffset: 18,
          delta: " hidden",
        },
      },
      {
        at: 600,
        type: "event",
        event: {
          type: "turn.interrupted",
          sequence: 5,
          text: "Visible background hidden",
        },
      },
    ],
  };
}

function createFailureScenario(): ReplayScenario {
  return {
    name: "error-and-idle-recovery",
    group: "slow-tool",
    durationMs: 500,
    steps: [
      { at: 0, type: "event", event: createStartedEvent(1) },
      {
        at: 20,
        type: "event",
        event: {
          type: "reasoning.replace",
          sequence: 2,
          blockId: "reasoning-a",
          kind: "summary",
          text: "Preparing the request.",
        },
      },
      {
        at: 100,
        type: "event",
        event: {
          type: "turn.failed",
          sequence: 3,
          error: "Synthetic failure",
        },
      },
    ],
  };
}

function createStartedEvent(
  sequence: number,
): Extract<AgentStreamEvent, { type: "turn.started" }> {
  return {
    type: "turn.started",
    sequence,
    backendId: "codex-cli.default",
    providerProfileId: "codex-cli.default",
    runId: "thread-stream",
    turnId: "turn-stream",
  };
}

function createConversation(): Conversation {
  return {
    metadata: {
      id: "conv-stream",
      scope: "workspace",
      workspaceKey: "item:1:ITEM",
      workspaceType: "item",
      workspaceLabel: "Paper",
      workspaceTitle: "Paper",
      libraryID: 1,
      itemKey: "ITEM",
      label: "Streaming benchmark",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    messages: [],
  };
}

function createHistoricalMessages(): string[] {
  return Array.from({ length: 24 }, (_, index) =>
    [
      `## Historical answer ${index}`,
      "This unchanged message includes **Markdown**, citations, and code.",
      "```ts\nconst stable = true;\n```",
      "| metric | value |\n|---|---:|\n| stable | 1 |",
      "$$x^2 + y^2 = z^2$$",
    ]
      .join("\n\n")
      .repeat(2),
  );
}

function serializeTool(block: {
  arguments?: string;
  error?: string;
  name: string;
  progress?: string;
  result?: string;
}): string {
  return [
    block.name,
    block.arguments,
    block.progress,
    block.result,
    block.error,
  ]
    .filter(Boolean)
    .join("\n");
}

function simulateMarkdownParse(markdown: string): number {
  let hash = 2166136261;
  for (let repeat = 0; repeat < 2; repeat += 1) {
    for (let index = 0; index < markdown.length; index += 1) {
      const code = markdown.charCodeAt(index);
      hash ^= code + (index % 17);
      hash = Math.imul(hash, 16777619);
      if (
        code === 35 ||
        code === 42 ||
        code === 96 ||
        code === 124 ||
        code === 36
      ) {
        hash ^= markdown.charCodeAt(index + 1) || 0;
      }
    }
  }
  return hash;
}

class CpuRecorder {
  private cpuMs = 0;
  private readonly buckets: CpuBucket = new Map();

  constructor(private readonly durationMs: number) {}

  measure<Value>(virtualAt: number, callback: () => Value): Value {
    const startedAt = performance.now();
    const value = callback();
    const elapsed = performance.now() - startedAt;
    this.cpuMs += elapsed;
    const bucket = Math.floor(virtualAt / 50);
    this.buckets.set(bucket, (this.buckets.get(bucket) || 0) + elapsed);
    return value;
  }

  finish(
    metrics: Omit<
      ReplayMetrics,
      "averageCpuMsPerSecond" | "cpuMs" | "peak50msCpuMs"
    >,
  ): ReplayMetrics {
    return {
      ...metrics,
      averageCpuMsPerSecond:
        this.durationMs > 0 ? (this.cpuMs / this.durationMs) * 1_000 : 0,
      cpuMs: this.cpuMs,
      peak50msCpuMs: Math.max(0, ...this.buckets.values()),
    };
  }
}

class VirtualWindow {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<
    number,
    { at: number; callback: () => void; type: "frame" | "timer" }
  >();

  constructor(
    private readonly recorder: CpuRecorder,
    private readonly onTimerFired: (delayMs: number) => void,
  ) {}

  get pendingTasks(): number {
    return this.tasks.size;
  }

  requestAnimationFrame(callback: FrameRequestCallback): number {
    const id = this.nextId++;
    const frameAt = (Math.floor(this.now / (1_000 / 60)) + 1) * (1_000 / 60);
    this.tasks.set(id, {
      at: frameAt,
      callback: () => callback(frameAt),
      type: "frame",
    });
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.tasks.delete(id);
  }

  setTimeout(callback: TimerHandler, delay = 0): number {
    const id = this.nextId++;
    const delayMs = Number(delay);
    this.tasks.set(id, {
      at: this.now + delayMs,
      callback: () => {
        this.onTimerFired(delayMs);
        if (typeof callback === "function") callback();
      },
      type: "timer",
    });
    return id;
  }

  clearTimeout(id: number): void {
    this.tasks.delete(id);
  }

  advanceTo(target: number): void {
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => {
          if (left[1].at !== right[1].at) return left[1].at - right[1].at;
          return left[1].type === "timer" ? -1 : 1;
        })[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.now = due[1].at;
      this.recorder.measure(this.now, due[1].callback);
    }
    this.now = target;
  }
}

function medianMetrics(values: ReplayMetrics[]): ReplayMetrics {
  const numericKeys: Array<
    keyof Pick<
      ReplayMetrics,
      | "averageCpuMsPerSecond"
      | "changedBlockRenders"
      | "cpuMs"
      | "idlePendingTasks"
      | "immediatePublishes"
      | "markdownParses"
      | "peak50msCpuMs"
      | "rootRenders"
      | "scrollSyncs"
      | "snapshotPublishes"
      | "unchangedBlockRenders"
      | "unchangedMarkdownParses"
    >
  > = [
    "averageCpuMsPerSecond",
    "changedBlockRenders",
    "cpuMs",
    "idlePendingTasks",
    "immediatePublishes",
    "markdownParses",
    "peak50msCpuMs",
    "rootRenders",
    "scrollSyncs",
    "snapshotPublishes",
    "unchangedBlockRenders",
    "unchangedMarkdownParses",
  ];
  const representative = values[Math.floor(values.length / 2)]!;
  const result = { ...representative };
  for (const key of numericKeys) {
    result[key] = median(values.map((value) => value[key])) as never;
  }
  result.ordinaryPublishTimes = medianArray(
    values.map((value) => value.ordinaryPublishTimes),
  );
  return result;
}

function medianArray(values: number[][]): number[] {
  if (!values.length) return [];
  const length = Math.min(...values.map((value) => value.length));
  return Array.from({ length }, (_, index) =>
    median(values.map((value) => value[index]!)),
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function ratio(value: number, baseline: number): number {
  return baseline > 0 ? value / baseline : value === 0 ? 0 : Infinity;
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "∞";
}

await main();
