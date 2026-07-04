import { CodexCliBackend } from "./backends/codexCliBackend";
import type {
  AgentBackend,
  AgentCancelInput,
  AgentCapabilities,
  AgentModelEntry,
  AgentPromptCallbacks,
  AgentPromptInput,
  AgentRunResult,
  BackendStatusResult,
  ProviderProfileWithSecret,
} from "./types";

export { createBackendForProfile };

function createBackendForProfile(
  profile: ProviderProfileWithSecret,
): AgentBackend {
  if (profile.kind === "codex-cli") {
    return new CodexCliBackend(profile);
  }
  return new LazyOpenAICompatibleBackend(profile);
}

class LazyOpenAICompatibleBackend implements AgentBackend {
  readonly id: string;
  readonly label: string;
  readonly kind = "openai-compatible" as const;
  readonly capabilities: AgentCapabilities;
  private backend: AgentBackend | undefined;
  private loading: Promise<AgentBackend> | undefined;

  constructor(private readonly profile: ProviderProfileWithSecret) {
    this.id = profile.id;
    this.label = profile.displayName;
    this.capabilities = profile.capabilities;
  }

  async checkStatus(): Promise<BackendStatusResult> {
    return (await this.load()).checkStatus();
  }

  async listModels(): Promise<AgentModelEntry[]> {
    return (await this.load()).listModels();
  }

  async sendPrompt(
    input: AgentPromptInput,
    callbacks?: AgentPromptCallbacks,
  ): Promise<AgentRunResult> {
    return (await this.load()).sendPrompt(input, callbacks);
  }

  async cancelTurn(input: AgentCancelInput): Promise<void> {
    return (await this.load()).cancelTurn(input);
  }

  async dispose(): Promise<void> {
    if (this.backend) {
      await this.backend.dispose();
    }
    this.backend = undefined;
    this.loading = undefined;
  }

  private async load(): Promise<AgentBackend> {
    if (this.backend) {
      return this.backend;
    }
    this.loading ??= import("./backends/openaiCompatibleAgentsBackend").then(
      ({ OpenAICompatibleAgentsBackend }) =>
        new OpenAICompatibleAgentsBackend(this.profile),
    );
    this.backend = await this.loading;
    return this.backend;
  }
}
