import type { AgentsInfo, ConversationSummary, HealthInfo, StreamEvent, Turn } from "../../shared/events";
import { parseSse } from "./sse";

export async function streamChat(args: {
  conversationId: string | null;
  message: string;
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: args.conversationId, message: args.message }),
    signal: args.signal,
  });
  if (!response.ok || !response.body) throw new Error(`The chat request failed (HTTP ${response.status}).`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const { events, rest } = parseSse(buffer);
    buffer = rest;
    events.forEach(args.onEvent);
  }
}

export async function getConversation(id: string): Promise<{ id: string; turns: Turn[] } | null> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load the conversation (HTTP ${response.status}).`);
  return response.json();
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await fetch("/api/conversations");
  if (!response.ok) throw new Error(`Could not load the history (HTTP ${response.status}).`);
  const body: { conversations: ConversationSummary[] } = await response.json();
  return body.conversations;
}

export async function getHealth(): Promise<HealthInfo> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error(`Health check failed (HTTP ${response.status}).`);
  return response.json();
}

export async function getAgents(): Promise<AgentsInfo> {
  const response = await fetch("/api/agents");
  if (!response.ok) throw new Error(`Could not load the agents (HTTP ${response.status}).`);
  return response.json();
}
