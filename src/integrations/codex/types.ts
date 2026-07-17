import type { ConversationMetadata } from "../../domain/conversation";
import type { AgentStreamEvent } from "../../domain/agent/streaming";

type CodexPromptResult = {
  threadId: string;
  turnId?: string;
  text: string;
  status: "completed" | "interrupted";
};

type CodexPromptOptions = {
  backendId: string;
  providerProfileId: string;
  conversation: ConversationMetadata;
  model?: string;
  effort?: string | null;
  onEvent?: (event: AgentStreamEvent) => void;
};

type CodexModelInfo = {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type { CodexModelInfo, CodexPromptOptions, CodexPromptResult };
