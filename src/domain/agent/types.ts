import type { ResolvedNoteContext } from "../conversation";
import type { ProviderCheckpoint, ThreadRunInput } from "../thread";
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
  contextLength?: number;
  visible?: boolean;
};

export type DiscoveredModelPricing = {
  prompt?: string;
  completion?: string;
  request?: string;
};

/**
 * Ephemeral metadata returned by provider discovery. Catalog fields are used to
 * help users choose models and are deliberately excluded from saved profiles.
 */
export type DiscoveredAgentModel = AgentModelEntry & {
  authorSlug?: string;
  catalogOrder: number;
  contextLength?: number;
  createdAt?: number;
  expirationDate?: string;
  inputModalities: string[];
  isFree: boolean;
  outputModalities: string[];
  pricing?: DiscoveredModelPricing;
  supportedParameters: string[];
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
  | "node_version_unsupported"
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
  checkpoint?: ProviderCheckpoint;
};

export type AgentPromptInput = ThreadRunInput & {
  resolvedNoteContexts?: ResolvedNoteContext[];
  preparedLocalAttachments?: PreparedLocalAttachments;
};

export type PreparedAttachmentImage = {
  filename: string;
  path: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  page?: number;
};

export type PreparedLocalAttachments = {
  text?: string;
  images: PreparedAttachmentImage[];
  omittedImageCount: number;
  warnings: string[];
  validAttachmentCount: number;
};

export type AgentPromptCallbacks = {
  onEvent?: (event: AgentStreamEvent) => void;
  onCheckpoint?: (checkpoint: ProviderCheckpoint) => Promise<void>;
};

export type AgentCancelInput = {
  conversationId: string;
  providerProfileId?: string;
  runId?: string;
  turnId?: string;
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
