import type { AgentBackendKind, AgentProviderPreset } from "./types";

type ProviderBrand =
  | "codex"
  | "openai"
  | "deepseek"
  | "minimax"
  | "z-ai"
  | "generic";

type ProviderBrandSource = {
  kind?: AgentBackendKind;
  preset?: AgentProviderPreset;
  displayName?: string;
  baseURL?: string;
  model?: string;
};

function resolveProviderBrand(source: ProviderBrandSource): ProviderBrand {
  if (source.kind === "codex-cli" || source.preset === "codex-cli") {
    return "codex";
  }
  if (source.preset && source.preset !== "openai-compatible") {
    return source.preset;
  }

  const identity = [source.displayName, source.baseURL, source.model]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (identity.includes("deepseek")) return "deepseek";
  if (identity.includes("minimax")) return "minimax";
  if (
    identity.includes("z.ai") ||
    identity.includes("z-ai") ||
    identity.includes("zhipu") ||
    identity.includes("bigmodel") ||
    /(^|[^a-z])glm(?:[^a-z]|$)/u.test(identity)
  ) {
    return "z-ai";
  }
  if (
    identity.includes("openai") ||
    identity.includes("chatgpt") ||
    /(^|[^a-z])gpt(?:[^a-z]|$)/u.test(identity)
  ) {
    return "openai";
  }
  return "generic";
}

function isProviderBrand(value: unknown): value is ProviderBrand {
  return (
    value === "codex" ||
    value === "openai" ||
    value === "deepseek" ||
    value === "minimax" ||
    value === "z-ai" ||
    value === "generic"
  );
}

export { isProviderBrand, resolveProviderBrand };
export type { ProviderBrand, ProviderBrandSource };
