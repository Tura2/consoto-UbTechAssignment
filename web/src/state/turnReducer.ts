// Applies stream events to one turn's view. Pure, so it is easy to test and the UI never blocks on it.
import type { AgentId, Source, Trip } from "../../../shared/domain";
import type { Card, LlmCaller, StepOwner, StreamEvent } from "../../../shared/events";

export type TurnStatus = "running" | "done" | "stopped" | "error";

export type StepView = {
  callId: string;
  owner: StepOwner;
  tool: string;
  input: unknown;
  status: "running" | "ok" | "error";
  summary: string;
  data: unknown;
  sources: Source[];
  gaps: string[];
  cached: boolean;
  ms: number | null;
};

// startedAt is the browser clock when the agent started. It is null for a reloaded turn, which has no live timing.
export type AgentView = {
  agent: AgentId;
  task: string;
  status: "running" | "ok" | "error" | "timeout";
  summary: string;
  startedAt: number | null;
  ms: number | null;
};
export type LlmView = { who: LlmCaller; model: string; attempt: number; status: "ok" | "rate_limited" | "error" | "empty"; ms: number; detail: string | null };
export type WaitView = { who: LlmCaller; waitMs: number; reason: "local_limit" | "retry_after" };

export type TurnView = {
  id: string;
  userMessage: string;
  status: TurnStatus;
  startedAt: number | null;
  plan: { agents: { agent: AgentId; task: string }[]; reason: string; clarify: string | null; trip: Trip; ms: number } | null;
  agents: AgentView[];
  steps: StepView[];
  llm: LlmView[];
  waits: WaitView[];
  cards: Card[];
  answer: string;
  llmCalls: number;
  ms: number | null;
  error: string | null;
};

export function newTurn(id: string, userMessage: string, startedAt: number | null): TurnView {
  return { id, userMessage, status: "running", startedAt, plan: null, agents: [], steps: [], llm: [], waits: [], cards: [], answer: "", llmCalls: 0, ms: null, error: null };
}

// now is the browser clock for live timers; null when replaying stored events.
export function applyEvent(turn: TurnView, event: StreamEvent, now: number | null): TurnView {
  switch (event.type) {
    case "turn_start":
      return { ...turn, id: event.turnId };
    case "plan":
      return { ...turn, plan: { agents: event.agents, reason: event.reason, clarify: event.clarify, trip: event.trip, ms: event.ms } };
    case "agent_start":
      return { ...turn, agents: [...turn.agents, { agent: event.agent, task: event.task, status: "running", summary: "", startedAt: now, ms: null }] };
    case "agent_end":
      return {
        ...turn,
        agents: turn.agents.map((agent) => (agent.agent === event.agent ? { ...agent, status: event.status, summary: event.summary, ms: event.ms } : agent)),
      };
    case "tool_start":
      return {
        ...turn,
        steps: [
          ...turn.steps,
          { callId: event.callId, owner: event.owner, tool: event.tool, input: event.input, status: "running", summary: "", data: null, sources: [], gaps: [], cached: false, ms: null },
        ],
      };
    case "tool_end":
      return {
        ...turn,
        steps: turn.steps.map((step) =>
          step.callId === event.callId
            ? { ...step, status: event.ok ? "ok" : "error", summary: event.summary, data: event.data, sources: event.sources, gaps: event.gaps, cached: event.cached, ms: event.ms }
            : step,
        ),
      };
    case "llm_call":
      return {
        ...turn,
        llmCalls: turn.llmCalls + 1,
        llm: [...turn.llm, { who: event.who, model: event.model, attempt: event.attempt, status: event.status, ms: event.ms, detail: event.detail }],
      };
    case "llm_wait":
      return { ...turn, waits: [...turn.waits, { who: event.who, waitMs: event.waitMs, reason: event.reason }] };
    case "card":
      return { ...turn, cards: [...turn.cards, event.card] };
    case "answer_delta":
      return { ...turn, answer: turn.answer + event.text };
    case "turn_end":
      return {
        ...turn,
        status: event.status,
        llmCalls: event.llmCalls,
        ms: event.ms,
        error: event.error,
        agents: turn.agents.map((agent) => (agent.status === "running" ? { ...agent, status: "error" } : agent)),
        steps: turn.steps.map((step) => (step.status === "running" ? { ...step, status: "error", summary: "Stopped" } : step)),
      };
  }
}

// Rebuilds a stored turn after a page reload.
export function turnFromEvents(id: string, userMessage: string, events: StreamEvent[], status: TurnStatus): TurnView {
  const turn = events.reduce((view, event) => applyEvent(view, event, null), newTurn(id, userMessage, null));
  return turn.status === "running" && status !== "running" ? { ...turn, status } : turn;
}
