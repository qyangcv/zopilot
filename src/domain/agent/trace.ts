import type { JsonValue } from "../../runtime/json/types";

export type AgentContentPhase = "commentary" | "final_answer" | "candidate";

export type AgentReasoningKind = "content" | "summary";

export type AgentToolKind =
  | "mcp"
  | "command"
  | "file-change"
  | "web-search"
  | "image-view"
  | "dynamic"
  | "collaboration"
  | "generic";

export type AgentToolStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentToolRisk = "read-only" | "network" | "write" | "unknown";

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
      kind?: AgentToolKind;
      risk?: AgentToolRisk;
      name: string;
      server?: string;
      arguments?: string;
      progress?: string;
      result?: string;
      resultTruncated?: boolean;
      structuredContent?: JsonValue;
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
      optionalToolKind(item.kind) &&
      optionalToolRisk(item.risk) &&
      optionalString(item.arguments) &&
      optionalString(item.progress) &&
      optionalString(item.result) &&
      optionalBoolean(item.resultTruncated) &&
      optionalJsonValue(item.structuredContent) &&
      optionalString(item.error) &&
      optionalNonNegativeNumber(item.startedAt) &&
      optionalNonNegativeNumber(item.durationMs)
    );
  }
  return false;
}

function optionalToolRisk(value: unknown): boolean {
  return (
    value === undefined ||
    ["read-only", "network", "write", "unknown"].includes(String(value))
  );
}

function optionalJsonValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(optionalJsonValue);
  return (
    typeof value === "object" &&
    Object.values(value as Record<string, unknown>).every(optionalJsonValue)
  );
}

function optionalToolKind(value: unknown): boolean {
  return (
    value === undefined ||
    [
      "mcp",
      "command",
      "file-change",
      "web-search",
      "image-view",
      "dynamic",
      "collaboration",
      "generic",
    ].includes(String(value))
  );
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}
