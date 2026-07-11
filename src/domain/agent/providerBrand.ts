import { isProviderId, resolveProviderId } from "./modelCatalog";
import type { AgentBackendKind, AgentProviderId } from "./types";

type ProviderBrand = AgentProviderId | "openai" | "generic";

type ProviderBrandSource = {
  kind?: AgentBackendKind;
  providerId?: AgentProviderId;
  baseURL?: string;
};

function resolveProviderBrand(source: ProviderBrandSource): ProviderBrand {
  if (source.providerId) return source.providerId;
  if (source.kind === "codex-cli") return "codex";
  return resolveProviderId(source.baseURL);
}

function isProviderBrand(value: unknown): value is ProviderBrand {
  // `openai` remains readable for conversation history written by older builds.
  return value === "openai" || value === "generic" || isProviderId(value);
}

export { isProviderBrand, resolveProviderBrand };
export type { ProviderBrand, ProviderBrandSource };
