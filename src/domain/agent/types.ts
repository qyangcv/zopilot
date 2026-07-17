import type {
  Conversation,
  LocalAttachmentRef,
  SourceMention,
} from "../conversation";
import type { AgentStreamEvent } from "./streaming";

export type AgentBackendKind = "codex-cli" | "openai-compatible";

export type AgentProviderId =
  | "codex"
  | "openrouter"
  | "deepseek"
  | "z-ai"
  | "minimax"
  | "moonshot"
  | "alibaba-bailian"
  | "xiaomi-mimo"
  | "custom";

export type AgentCapabilityKey =
  | "streaming"
  | "tools"
  | "images"
  | "cancellation"
  | "modelListing"
  | "reasoning"
  | "structuredOutput"
  | "usageMetadata";

export type AgentCapabilities = Record<AgentCapabilityKey, boolean>;

export type AgentModelEntry = {
  id: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type ProviderConnectionStatus =
  | "unchecked"
  | "checking"
  | "connected"
  | "disconnected";

export type AgentDiagnosticCode =
  | "missing_codex_cli"
  | "codex_not_signed_in"
  | "provider_profile_incomplete"
  | "byok_runtime_unavailable"
  | "invalid_api_key"
  | "provider_unauthorized"
  | "model_not_found"
  | "tool_calling_unsupported"
  | "stream_interrupted"
  | "rate_limited"
  | "provider_timeout"
  | "provider_server_error"
  | "network_unavailable"
  | "unknown_backend_error";

export type AgentDiagnostic = {
  code: AgentDiagnosticCode;
  message: string;
  messageKey?: string;
  technicalMessage?: string;
};

export type ProviderProfile = {
  id: string;
  kind: AgentBackendKind;
  providerId: AgentProviderId;
  displayName: string;
  baseURL?: string;
  apiKeyRef?: string;
  hasApiKey?: boolean;
  defaultModel?: string;
  models: AgentModelEntry[];
  capabilities: AgentCapabilities;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
  status: ProviderConnectionStatus;
  lastCheckedAt?: string;
  lastDiagnostic?: AgentDiagnostic;
};

export type ProviderProfileWithSecret = ProviderProfile & {
  apiKey?: string;
};

export type ProviderProfileInput = {
  providerId: Exclude<AgentProviderId, "codex">;
  displayName?: string;
  baseURL?: string;
  apiKey?: string;
  models?: AgentModelEntry[];
  capabilities?: Partial<AgentCapabilities>;
  timeoutMs?: number;
  retryCount?: number;
  enabled?: boolean;
};

export type BackendStatusResult = {
  status: Exclude<ProviderConnectionStatus, "unchecked" | "checking">;
  diagnostic?: AgentDiagnostic;
  models?: AgentModelEntry[];
};

export type AgentRunResult = {
  backendId: string;
  providerProfileId: string;
  runId: string;
  turnId?: string;
  text: string;
  status: "completed" | "interrupted";
  legacy?: {
    codexThreadId?: string;
    codexTurnId?: string;
  };
};

export type AgentPromptInput = {
  providerProfileId?: string;
  conversation: Conversation;
  prompt: string;
  model?: string;
  reasoningEffort?: string | null;
  mentions?: SourceMention[];
  localAttachments?: LocalAttachmentRef[];
};

export type AgentPromptCallbacks = {
  onEvent?: (event: AgentStreamEvent) => void;
};

export type AgentCancelInput = {
  conversationId: string;
  providerProfileId?: string;
  runId?: string;
  turnId?: string;
  legacy?: {
    codexThreadId?: string;
    codexTurnId?: string;
  };
};

export interface AgentBackend {
  readonly id: string;
  readonly label: string;
  readonly kind: AgentBackendKind;
  readonly capabilities: AgentCapabilities;
  checkStatus(): Promise<BackendStatusResult>;
  listModels(): Promise<AgentModelEntry[]>;
  sendPrompt(
    input: AgentPromptInput,
    callbacks?: AgentPromptCallbacks,
  ): Promise<AgentRunResult>;
  cancelTurn(input: AgentCancelInput): Promise<void>;
  dispose(): Promise<void> | void;
}
