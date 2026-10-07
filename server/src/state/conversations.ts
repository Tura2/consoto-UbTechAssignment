// Conversations: one user, no login. Kept in memory and, when the store has a directory, saved to disk after every turn.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentId, Trip } from "../../../shared/domain";
import type { ConversationSummary, StreamEvent } from "../../../shared/events";
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
  updatedAt: string;
  active: AbortController | null;
};

export type Store = {
  get(id: string): Conversation | null;
  getOrCreate(id?: string | null): Conversation;
  save(conversation: Conversation): void;
  list(): ConversationSummary[];
};

// Ids become file names, so only these may be used.
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;
const TITLE_LENGTH = 80;

// With a directory, each conversation is also saved as <dir>/<id>.json and loaded again on startup.
export function createStore(makeTrip: () => Trip, options: { dir?: string } = {}): Store {
  const { dir } = options;
  const conversations = new Map<string, Conversation>();
  if (dir) loadAll(dir, conversations);
  return {
    get: (id) => conversations.get(id) ?? null,
    getOrCreate(id) {
      const existing = id ? conversations.get(id) : undefined;
      if (existing) return existing;
      const conversation: Conversation = {
        id: id && SAFE_ID.test(id) ? id : randomUUID(),
        trip: makeTrip(),
        findings: {},
        turns: [],
        updatedAt: new Date().toISOString(),
        active: null,
      };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    save(conversation) {
      conversation.updatedAt = new Date().toISOString();
      if (!dir) return;
      const { id, trip, findings, turns, updatedAt } = conversation;
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, trip, findings, turns, updatedAt }));
      } catch (error) {
        console.warn(`Could not save conversation ${id}: ${(error as Error).message}`);
      }
    },
    list: () =>
      [...conversations.values()]
        .filter((conversation) => conversation.turns.length > 0)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((conversation) => ({
          id: conversation.id,
          title: shortTitle(conversation.turns[0]!.userMessage),
          updatedAt: conversation.updatedAt,
          turns: conversation.turns.length,
        })),
  };
}

function shortTitle(message: string): string {
  return message.length > TITLE_LENGTH ? `${message.slice(0, TITLE_LENGTH)}...` : message;
}

function loadAll(dir: string, conversations: Map<string, Conversation>): void {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    try {
      const saved = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      if (!SAFE_ID.test(saved.id)) throw new Error("bad id");
      conversations.set(saved.id, { ...saved, active: null });
    } catch (error) {
      console.warn(`Skipped ${file}: ${(error as Error).message}`);
    }
  }
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
