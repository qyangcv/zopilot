import { normalizeBackendError } from "../../../../domain/agent/errors";
import type { AgentDiagnosticCode } from "../../../../domain/agent/types";
import type { FluentMessageId } from "../../../../../typings/i10n";
import { localized, type LocalizedMessage } from "../../localization";

export { providerDiagnosticMessage, providerErrorMessage };

const DIAGNOSTIC_MESSAGE_IDS: Record<AgentDiagnosticCode, FluentMessageId> = {
  missing_codex_cli: "pref-provider-diagnostic-missing-codex-cli",
  codex_not_signed_in: "pref-provider-diagnostic-codex-not-signed-in",
  provider_profile_incomplete: "pref-provider-diagnostic-profile-incomplete",
  byok_runtime_unavailable: "pref-provider-diagnostic-byok-runtime-unavailable",
  invalid_api_key: "pref-provider-diagnostic-invalid-api-key",
  provider_unauthorized: "pref-provider-diagnostic-unauthorized",
  model_not_found: "pref-provider-diagnostic-model-not-found",
  tool_calling_unsupported: "pref-provider-diagnostic-tool-calling-unsupported",
  stream_interrupted: "pref-provider-diagnostic-stream-interrupted",
  rate_limited: "pref-provider-diagnostic-rate-limited",
  provider_timeout: "pref-provider-diagnostic-timeout",
  provider_server_error: "pref-provider-diagnostic-server-error",
  network_unavailable: "pref-provider-diagnostic-network-unavailable",
  unknown_backend_error: "pref-provider-diagnostic-unknown-error",
};

function providerDiagnosticMessage(
  code: AgentDiagnosticCode,
): LocalizedMessage {
  return localized(DIAGNOSTIC_MESSAGE_IDS[code]);
}

function providerErrorMessage(error: unknown): LocalizedMessage {
  const diagnostic = normalizeBackendError(error);
  return providerDiagnosticMessage(
    diagnostic.code === "stream_interrupted"
      ? "provider_timeout"
      : diagnostic.code,
  );
}
