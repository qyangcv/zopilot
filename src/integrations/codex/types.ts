import type { AgentStreamEvent } from "../../domain/agent/streaming";
import type { ProviderCheckpoint, ThreadRunInput } from "../../domain/thread";

type CodexPromptResult = {
  threadId: string;
  turnId?: string;
  text: string;
  status: "completed" | "interrupted";
  checkpoint: ProviderCheckpoint;
};

type CodexPromptOptions = {
  backendId: string;
  providerProfileId: string;
  run: ThreadRunInput;
  model?: string;
  effort?: string | null;
  onEvent?: (event: AgentStreamEvent) => void;
  onCheckpoint?: (checkpoint: ProviderCheckpoint) => Promise<void>;
};

type CodexModelInfo = {
  slug: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort?: string;
};

export type { CodexModelInfo, CodexPromptOptions, CodexPromptResult };
