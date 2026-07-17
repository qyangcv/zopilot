import type { AgentRunResult } from "./types";
import type { ProviderBrand } from "./providerBrand";
import type {
  AgentContentPhase,
  AgentReasoningKind,
  AgentToolStatus,
  AgentTraceItem,
} from "./trace";

type AgentStreamEventBase = {
  sequence: number;
};

type AgentStreamAppendEventBase = AgentStreamEventBase & {
  expectedOffset: number;
  delta: string;
};

export type AgentStreamEvent =
  | (AgentStreamEventBase & {
      type: "turn.started";
      backendId: string;
      providerProfileId: string;
      runId: string;
      turnId?: string;
      legacy?: AgentRunResult["legacy"];
    })
  | (AgentStreamEventBase & {
      type: "turn.interruptRequested";
    })
  | (AgentStreamEventBase & {
      type: "turn.completed";
      text: string;
    })
  | (AgentStreamEventBase & {
      type: "turn.interrupted";
      text: string;
    })
  | (AgentStreamEventBase & {
      type: "turn.failed";
      error: string;
    })
  | (AgentStreamAppendEventBase & {
      type: "content.append";
      blockId: string;
      phase: AgentContentPhase;
    })
  | (AgentStreamEventBase & {
      type: "content.replace";
      blockId: string;
      phase: AgentContentPhase;
      text: string;
    })
  | (AgentStreamEventBase & {
      type: "content.phase";
      blockId: string;
      phase: AgentContentPhase;
    })
  | (AgentStreamAppendEventBase & {
      type: "reasoning.append";
      blockId: string;
      kind: AgentReasoningKind;
    })
  | (AgentStreamEventBase & {
      type: "reasoning.replace";
      blockId: string;
      kind: AgentReasoningKind;
      text: string;
    })
  | (AgentStreamEventBase & {
      type: "tool.started";
      blockId: string;
      name: string;
      server?: string;
      arguments?: string;
    })
  | (AgentStreamAppendEventBase & {
      type: "tool.arguments.append";
      blockId: string;
    })
  | (AgentStreamAppendEventBase & {
      type: "tool.progress.append";
      blockId: string;
    })
  | (AgentStreamEventBase & {
      type: "tool.completed";
      blockId: string;
      name?: string;
      server?: string;
      arguments?: string;
      result?: string;
      error?: string;
    })
  | (AgentStreamEventBase & {
      type: "notice.upsert";
      blockId: string;
      text: string;
    });

export type AgentStreamEventInput = AgentStreamEvent extends infer Event
  ? Event extends AgentStreamEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export type RunningTurnLifecycle =
  | "running"
  | "interrupting"
  | "completed"
  | "interrupted"
  | "failed";

export type RunningTurnContentBlock = {
  id: string;
  type: "content";
  phase: AgentContentPhase;
  text: string;
  revision: number;
};

export type RunningTurnReasoningBlock = {
  id: string;
  type: "reasoning";
  kind: AgentReasoningKind;
  text: string;
  revision: number;
};

export type RunningTurnCommentaryBlock = {
  id: string;
  type: "commentary";
  text: string;
  revision: number;
};

export type RunningTurnToolBlock = {
  id: string;
  type: "tool";
  name: string;
  server?: string;
  arguments?: string;
  progress?: string;
  result?: string;
  error?: string;
  status: AgentToolStatus;
  startedAt?: number;
  durationMs?: number;
  revision: number;
};

export type RunningTurnNoticeBlock = {
  id: string;
  type: "notice";
  text: string;
  revision: number;
};

export type RunningTurnTraceBlock =
  | RunningTurnReasoningBlock
  | RunningTurnCommentaryBlock
  | RunningTurnToolBlock
  | RunningTurnNoticeBlock;

export type RunningTurnSnapshot = {
  conversationId: string;
  messageId: string;
  lifecycle: RunningTurnLifecycle;
  stateVersion: number;
  sequence: number;
  model?: string;
  providerProfileId?: string;
  providerBrand?: ProviderBrand;
  finalStarted: boolean;
  answerBlocks: readonly RunningTurnContentBlock[];
  traceBlocks: readonly RunningTurnTraceBlock[];
};

export type RunningTurnProjection = {
  finalText: string;
  trace: AgentTraceItem[];
};
