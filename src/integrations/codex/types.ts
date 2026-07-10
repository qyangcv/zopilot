import type { ConversationMetadata } from "../../domain/conversation";
import type { AgentTraceEvent } from "../../domain/agent/trace";

type CodexPromptResult = {
  threadId: string;
  turnId?: string;
  text: string;
  status: "completed" | "interrupted";
};

type CodexPromptOptions = {
  conversation: ConversationMetadata;
  model?: string;
  effort?: string | null;
  onDelta?: (delta: string) => void;
  onTraceEvent?: (event: AgentTraceEvent) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
  onTurnStarted?: (threadId: string, turnId: string) => void;
};

type CodexModelInfo = {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type { CodexModelInfo, CodexPromptOptions, CodexPromptResult };
