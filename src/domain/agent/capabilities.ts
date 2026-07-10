import type { AgentCapabilities, AgentProviderPreset } from "./types";

export {
  CODEX_CAPABILITIES,
  OPENAI_COMPATIBLE_BASELINE_CAPABILITIES,
  createCapabilities,
};

const CODEX_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  tools: true,
  images: true,
  cancellation: true,
  modelListing: true,
  reasoning: true,
  structuredOutput: false,
  usageMetadata: false,
};

const OPENAI_COMPATIBLE_BASELINE_CAPABILITIES: AgentCapabilities = {
  streaming: true,
  tools: true,
  images: false,
  cancellation: true,
  modelListing: true,
  reasoning: true,
  structuredOutput: false,
  usageMetadata: true,
};

function createCapabilities(
  preset: AgentProviderPreset,
  overrides: Partial<AgentCapabilities> = {},
): AgentCapabilities {
  const base =
    preset === "codex-cli"
      ? CODEX_CAPABILITIES
      : OPENAI_COMPATIBLE_BASELINE_CAPABILITIES;
  return {
    ...base,
    ...overrides,
  };
}
