export type AgentContentPhase = "commentary" | "final_answer" | "candidate";

export type AgentReasoningKind = "content" | "summary";

export type AgentToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentTraceItem =
  | {
      id: string;
      type: "reasoning";
      kind: AgentReasoningKind;
      text: string;
    }
  | {
      id: string;
      type: "commentary";
      text: string;
    }
  | {
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
    }
  | {
      id: string;
      type: "notice";
      text: string;
    };

export function isAgentTraceItem(value: unknown): value is AgentTraceItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Partial<AgentTraceItem> & Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.type !== "string") {
    return false;
  }
  if (item.type === "reasoning") {
    return (
      (item.kind === "content" || item.kind === "summary") &&
      typeof item.text === "string"
    );
  }
  if (item.type === "commentary" || item.type === "notice") {
    return typeof item.text === "string";
  }
  if (item.type === "tool") {
    return (
      typeof item.name === "string" &&
      (item.status === "running" ||
        item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted") &&
      optionalString(item.server) &&
      optionalString(item.arguments) &&
      optionalString(item.progress) &&
      optionalString(item.result) &&
      optionalString(item.error) &&
      optionalNonNegativeNumber(item.startedAt) &&
      optionalNonNegativeNumber(item.durationMs)
    );
  }
  return false;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}
