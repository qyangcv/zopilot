import type { JsonValue } from "../../runtime/json/types";
import type { CodexModelInfo } from "./types";
import {
  getNestedBoolean,
  getNestedString,
} from "../../runtime/json/accessors";
import { toError } from "../../runtime/errors/toError";

function getNotificationThreadId(
  value: JsonValue | undefined,
): string | undefined {
  return (
    getNestedString(value, ["thread", "id"]) ||
    getNestedString(value, ["threadId"]) ||
    getNestedString(value, ["turn", "threadId"]) ||
    getNestedString(value, ["item", "threadId"])
  );
}

function getNotificationTurnId(
  value: JsonValue | undefined,
): string | undefined {
  return (
    getNestedString(value, ["turn", "id"]) ||
    getNestedString(value, ["turnId"]) ||
    getNestedString(value, ["item", "turnId"])
  );
}

function getTurnKey(value: { threadId: string; turnId?: string }): string {
  return value.turnId
    ? `${value.threadId}\u0000${value.turnId}`
    : `${value.threadId}\u0000`;
}

function parseModelList(value: JsonValue | undefined): CodexModelInfo[] {
  const modelsValue = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? value.data || value.models
      : undefined;
  if (!Array.isArray(modelsValue)) {
    return [];
  }
  return modelsValue
    .map((item) => parseModelInfo(item))
    .filter((item): item is CodexModelInfo => Boolean(item));
}

function parseModelInfo(value: JsonValue): CodexModelInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const slug =
    stringProperty(value, "slug") ||
    stringProperty(value, "id") ||
    stringProperty(value, "model");
  if (!slug) {
    return null;
  }
  const displayName =
    stringProperty(value, "displayName") ||
    stringProperty(value, "display_name") ||
    stringProperty(value, "name") ||
    slug;
  return {
    slug,
    displayName: formatModelDisplayName(displayName),
    defaultReasoningEffort:
      stringProperty(value, "defaultReasoningEffort") ||
      stringProperty(value, "default_reasoning_level"),
    supportedReasoningEfforts:
      arrayOfStringsProperty(value, "supportedReasoningEfforts") ||
      arrayOfStringsProperty(value, "supported_reasoning_levels") ||
      [],
  };
}

function formatModelDisplayName(value: string): string {
  if (!/^gpt(?:-|$)/i.test(value)) {
    return value;
  }
  return value
    .split("-")
    .map((part) => {
      if (/^gpt$/i.test(part)) {
        return "GPT";
      }
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join("-");
}

function stringProperty(
  value: { [key: string]: JsonValue },
  key: string,
): string | undefined {
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}

function arrayOfStringsProperty(
  value: { [key: string]: JsonValue },
  key: string,
): string[] | undefined {
  const property = value[key];
  if (!Array.isArray(property)) {
    return undefined;
  }
  return property
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return (
          stringProperty(item, "reasoningEffort") ||
          stringProperty(item, "effort")
        );
      }
      return undefined;
    })
    .filter((item): item is string => typeof item === "string");
}

function formatServerError(params: JsonValue | undefined): string {
  const message =
    getNestedString(params, ["error", "message"]) ||
    getNestedString(params, ["message"]) ||
    "Codex app-server reported an error.";
  const details =
    getNestedString(params, ["error", "additionalDetails"]) ||
    getNestedString(params, ["additionalDetails"]);
  return [message, details].filter(Boolean).join("\n");
}

function summarizeJsonForLog(
  value: JsonValue | undefined,
): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = JSON.stringify(value);
  if (text.length <= 4000) {
    return value;
  }
  return `${text.slice(0, 4000)}...`;
}

export {
  formatServerError,
  getNestedBoolean,
  getNestedString,
  getNotificationThreadId,
  getNotificationTurnId,
  getTurnKey,
  parseModelList,
  summarizeJsonForLog,
  toError,
};
