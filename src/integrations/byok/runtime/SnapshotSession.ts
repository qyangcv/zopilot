import type { AgentInputItem, Session } from "@openai/agents";

/**
 * An ephemeral Agents SDK session seeded from Zopilot's canonical history.
 *
 * The SDK may append the current input and generated items while a run is in
 * progress, but the session is intentionally discarded afterwards. Zopilot's
 * SQLite thread remains the only durable state.
 */
class SnapshotSession implements Session {
  private items: AgentInputItem[];

  constructor(
    private readonly sessionId: string,
    initialItems: AgentInputItem[],
  ) {
    this.items = [...initialItems];
  }

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    if (limit === undefined) return [...this.items];
    return this.items.slice(Math.max(0, this.items.length - limit));
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    this.items.push(...items);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    return this.items.pop();
  }

  async clearSession(): Promise<void> {
    this.items = [];
  }
}

export { SnapshotSession };
