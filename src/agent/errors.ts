import type { AgentDiagnostic, AgentDiagnosticCode } from "./types";

export { createDiagnostic, normalizeBackendError, redactSecretText };

const DEFAULT_MESSAGES: Record<AgentDiagnosticCode, string> = {
  missing_codex_cli: "Codex CLI is not installed or cannot be found.",
  codex_not_signed_in: "Codex CLI is not signed in.",
  provider_profile_incomplete: "Provider profile is incomplete.",
  byok_runtime_unavailable:
    "BYOK runtime is unavailable. Install Node.js or restart Zotero.",
  invalid_api_key: "API key is missing or invalid.",
  provider_unauthorized: "Provider rejected the API key.",
  model_not_found: "The selected model was not found by the provider.",
  tool_calling_unsupported:
    "The selected provider or model did not accept tool calls.",
  stream_interrupted: "The response stream was interrupted.",
  rate_limited: "Provider rate limit was reached.",
  provider_timeout: "Provider request timed out.",
  provider_server_error: "Provider returned a server error.",
  network_unavailable: "Network connection to the provider failed.",
  unknown_backend_error: "The selected provider failed.",
};

function createDiagnostic(
  code: AgentDiagnosticCode,
  technicalMessage?: string,
): AgentDiagnostic {
  return {
    code,
    message: DEFAULT_MESSAGES[code],
    technicalMessage: technicalMessage
      ? redactSecretText(technicalMessage)
      : undefined,
  };
}

function normalizeBackendError(error: unknown): AgentDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("interrupt")) {
    return createDiagnostic("stream_interrupted", message);
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return createDiagnostic("provider_timeout", message);
  }
  if (
    lower.includes("byok runtime") ||
    lower.includes("unable to find node.js") ||
    lower.includes("cannot find module")
  ) {
    return createDiagnostic("byok_runtime_unavailable", message);
  }
  if (
    lower.includes("401") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return createDiagnostic("provider_unauthorized", message);
  }
  if (lower.includes("api key") || lower.includes("apikey")) {
    return createDiagnostic("invalid_api_key", message);
  }
  if (lower.includes("404") || lower.includes("model not found")) {
    return createDiagnostic("model_not_found", message);
  }
  if (lower.includes("429") || lower.includes("rate limit")) {
    return createDiagnostic("rate_limited", message);
  }
  if (lower.includes("tool") && lower.includes("unsupported")) {
    return createDiagnostic("tool_calling_unsupported", message);
  }
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("econn")
  ) {
    return createDiagnostic("network_unavailable", message);
  }
  if (/5\d\d/.test(lower)) {
    return createDiagnostic("provider_server_error", message);
  }
  return createDiagnostic("unknown_backend_error", message);
}

function redactSecretText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key["':=\s]+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "sk-[redacted]");
}
