import type { ThreadHistoryItem } from "../../../domain/thread";

const DEFAULT_CONTEXT_LENGTH = 32000;
const INPUT_BUDGET_RATIO = 0.7;

function projectThreadHistory(input: {
  history: ThreadHistoryItem[];
  contextLength?: number;
  currentInput: string;
}): ThreadHistoryItem[] {
  const contextLength =
    input.contextLength && input.contextLength > 0
      ? input.contextLength
      : DEFAULT_CONTEXT_LENGTH;
  const available = Math.max(
    0,
    Math.floor(contextLength * INPUT_BUDGET_RATIO) -
      estimateTextTokens(input.currentInput),
  );
  const selected: ThreadHistoryItem[] = [];
  let used = 0;
  for (const turn of [...input.history].reverse()) {
    const cost =
      estimateTextTokens(turn.userText) +
      estimateTextTokens(turn.assistantText) +
      16;
    if (used + cost > available) break;
    used += cost;
    selected.push(turn);
  }
  return selected.reverse();
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 3));
}

export {
  DEFAULT_CONTEXT_LENGTH,
  INPUT_BUDGET_RATIO,
  estimateTextTokens,
  projectThreadHistory,
};
