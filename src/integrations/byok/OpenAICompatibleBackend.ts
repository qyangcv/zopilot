import { getByokRuntimeBridge } from "./ByokRuntimeBridge";
import {
  createDiagnostic,
  normalizeBackendError,
} from "../../domain/agent/errors";
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
} from "../../domain/agent/types";

export { OpenAICompatibleAgentsBackend };

class OpenAICompatibleAgentsBackend implements AgentBackend {
  readonly id: string;
  readonly label: string;
  readonly kind = "openai-compatible" as const;
  readonly capabilities: AgentCapabilities;
  private readonly profile: ProviderProfileWithSecret;

  constructor(profile: ProviderProfileWithSecret) {
    this.profile = profile;
    this.id = profile.id;
    this.label = profile.displayName;
    this.capabilities = profile.capabilities;
  }

  async checkStatus(): Promise<BackendStatusResult> {
    const validation = validateProfile(this.profile);
    if (validation) {
      return {
        status: "disconnected",
        diagnostic: validation,
      };
    }
    try {
      const models = await this.listModels();
      return {
        status: "connected",
        models,
      };
    } catch (error) {
      const diagnostic = normalizeBackendError(error);
      return {
        status:
          diagnostic.code === "model_not_found" ? "connected" : "disconnected",
        diagnostic,
      };
    }
  }

  async listModels(): Promise<AgentModelEntry[]> {
    const validation = validateProfile(this.profile);
    if (validation) {
      throw new Error(validation.message);
    }
    return getByokRuntimeBridge().listModels(this.profile);
  }

  async sendPrompt(
    input: AgentPromptInput,
    callbacks?: AgentPromptCallbacks,
  ): Promise<AgentRunResult> {
    const validation = validateProfile(this.profile);
    if (validation) {
      throw new Error(validation.message);
    }
    return getByokRuntimeBridge().sendPrompt(this.profile, input, callbacks);
  }

  async cancelTurn(input: AgentCancelInput): Promise<void> {
    if (input.runId) {
      await getByokRuntimeBridge().interruptTurn(input.runId);
    }
  }

  dispose(): void {
    // The BYOK runtime is shared across provider profiles and is shut down from hooks.
  }
}

function validateProfile(profile: ProviderProfileWithSecret) {
  if (!profile.baseURL || !profile.apiKey || !profile.models.length) {
    return createDiagnostic("provider_profile_incomplete");
  }
  return undefined;
}
