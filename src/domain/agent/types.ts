import type {
  Conversation,
  LocalAttachmentRef,
  SourceMention,
} from "../conversation";

export type AgentBackendKind = "codex-cli" | "openai-compatible";

export type AgentProviderPreset =
  | "codex-cli"
  | "openai-compatible"
  | "deepseek"
  | "z-ai"
  | "minimax";

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
  preset: AgentProviderPreset;
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
  preset?: Exclude<AgentProviderPreset, "codex-cli">;
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
  onRunStarted?: (event: {
    backendId: string;
    providerProfileId: string;
    runId: string;
    turnId?: string;
    legacy?: AgentRunResult["legacy"];
  }) => void;
  onTextDelta?: (delta: string) => void;
  onNotice?: (notice: string) => void;
  onToolStarted?: (name: string) => void;
  onToolCompleted?: (name: string) => void;
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
