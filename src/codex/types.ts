import type { ConversationMetadata } from "../shared/conversation";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CodexPromptResult = {
  threadId: string;
  turnId?: string;
  text: string;
  status: "completed" | "interrupted";
};

export type CodexPromptOptions = {
  conversation: ConversationMetadata;
  model?: string;
  effort?: string | null;
  onDelta?: (delta: string) => void;
  onNotice?: (notice: string) => void;
  onToolActivity?: () => void;
  onTurnStarted?: (threadId: string, turnId: string) => void;
};

export type CodexModelInfo = {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};
