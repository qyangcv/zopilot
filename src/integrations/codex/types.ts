import type { ConversationMetadata } from "../../domain/conversation";

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
