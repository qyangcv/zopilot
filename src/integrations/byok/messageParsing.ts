import type {
  AgentRunResult,
  ProviderProfileWithSecret,
} from "../../domain/agent/types";
import { isRecord } from "../../runtime/json/guards";
import type { JsonValue } from "../../runtime/json/types";
import { createTimestampId } from "../../runtime/ids/timestampId";
import { getNestedString } from "../../runtime/json/accessors";
import { toError } from "../../runtime/errors/toError";

function sanitizeProfileForRuntime(
  profile: ProviderProfileWithSecret,
): JsonValue {
  return JSON.parse(JSON.stringify(profile)) as JsonValue;
}

function parseRunResult(
  result: JsonValue | undefined,
  profile: ProviderProfileWithSecret,
  runId: string,
): AgentRunResult {
  if (isRecord(result) && typeof result.text === "string") {
    return {
      backendId: profile.id,
      providerProfileId: profile.id,
      runId,
      text: result.text,
      status: result.status === "interrupted" ? "interrupted" : "completed",
    };
  }
  return {
    backendId: profile.id,
    providerProfileId: profile.id,
    runId,
    text: "",
    status: "completed",
  };
}

function getRunId(value: JsonValue | undefined): string | undefined {
  return getNestedString(value, ["runId"]);
}

function createRunId(): string {
  return createTimestampId("run", { separator: ".", randomLength: 6 });
}

export {
  createRunId,
  getNestedString,
  getRunId,
  parseRunResult,
  sanitizeProfileForRuntime,
  toError,
};
