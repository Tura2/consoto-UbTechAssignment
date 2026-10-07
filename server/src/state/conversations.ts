// In-memory conversations: one user, no login. A conversation survives a page refresh, not a restart.
import { randomUUID } from "node:crypto";
import type { AgentId, Trip } from "../../../shared/domain";
import type { StreamEvent } from "../../../shared/events";
import type { AgentResult } from "../agents/runner";
import type { ChatMessage } from "../llm/openrouter";

export type Turn = {
  id: string;
  userMessage: string;
  events: StreamEvent[];
  answer: string;
  status: "running" | "done" | "stopped" | "error";
};

export type Finding = { depsKey: string; result: AgentResult };

export type Conversation = {
  id: string;
  trip: Trip;
  findings: Partial<Record<AgentId, Finding>>;
  turns: Turn[];
  active: AbortController | null;
};

export type Store = {
  get(id: string): Conversation | null;
  getOrCreate(id?: string | null): Conversation;
};

export function createStore(makeTrip: () => Trip): Store {
  const conversations = new Map<string, Conversation>();
  return {
    get: (id) => conversations.get(id) ?? null,
    getOrCreate(id) {
      const existing = id ? conversations.get(id) : undefined;
      if (existing) return existing;
      const conversation: Conversation = { id: id ?? randomUUID(), trip: makeTrip(), findings: {}, turns: [], active: null };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
  };
}

// What the planner and the answer see of earlier turns: the user's words and our final answers,
// or a placeholder when a turn ended without one (so an interrupted request is not lost).
export function historyMessages(conversation: Conversation, limit = 10): ChatMessage[] {
  return conversation.turns
    .flatMap((turn): ChatMessage[] => [
      { role: "user", content: turn.userMessage },
      { role: "assistant", content: turn.answer || "(No answer: this turn was stopped or failed.)" },
    ])
    .slice(-limit);
}
