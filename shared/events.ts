// Stream events and API payloads shared by the server and the web app. Types only.
import type {
  AgentId,
  CityCost,
  DateWindow,
  HolidayItem,
  ItineraryCheck,
  ItineraryPlan,
  PolicyVerdict,
  Rate,
  Source,
  Trip,
  VenuesResult,
  WeatherOutlook,
} from "./domain";

export type ComparisonRow = {
  city: string;
  perPersonIls: number | null;
  teamTotalIls: number | null;
  withinBudget: boolean | null;
  cleanWindows: number | null;
  avgHighC: number | null;
  rainyDayShare: number | null;
};

export type Card =
  | { kind: "comparison"; days: number; nights: number; rate: Rate | null; rows: ComparisonRow[] }
  | { kind: "cost"; estimate: CityCost }
  | { kind: "dates"; city: string; from: string; to: string; holidays: HolidayItem[]; windows: DateWindow[] }
  | { kind: "weather"; city: string; outlook: WeatherOutlook }
  | { kind: "venues"; result: VenuesResult }
  | { kind: "itinerary"; city: string; plan: ItineraryPlan; check: ItineraryCheck; placeNames: Record<string, string> }
  | { kind: "policy"; city: string; verdict: PolicyVerdict };

export type StepOwner = AgentId | "orchestrator";
export type LlmCaller = "planner" | "answer" | AgentId;

export type StreamEvent =
  | { type: "turn_start"; conversationId: string; turnId: string }
  | { type: "plan"; agents: { agent: AgentId; task: string }[]; reason: string; trip: Trip; ms: number }
  | { type: "agent_start"; agent: AgentId }
  | { type: "agent_end"; agent: AgentId; status: "ok" | "error" | "timeout"; summary: string; ms: number }
  | { type: "tool_start"; callId: string; owner: StepOwner; tool: string; input: unknown }
  | {
      type: "tool_end";
      callId: string;
      ok: boolean;
      summary: string;
      data: unknown;
      sources: Source[];
      gaps: string[];
      cached: boolean;
      ms: number;
    }
  // model: the model that answered when ok (openrouter/free picks one for us), otherwise the model that was asked.
  | { type: "llm_call"; who: LlmCaller; model: string; status: "ok" | "rate_limited" | "error" | "empty"; ms: number; detail: string | null }
  | { type: "llm_wait"; waitMs: number; reason: "local_limit" | "retry_after" }
  | { type: "card"; card: Card }
  | { type: "answer_delta"; text: string }
  | { type: "turn_end"; status: "done" | "stopped" | "error"; llmCalls: number; ms: number; error: string | null };

export type Emit = (event: StreamEvent) => void;

export type TurnStatus = "running" | "done" | "stopped" | "error";

// One saved turn: what the user wrote, every event of the turn, and the final answer.
export type Turn = { id: string; userMessage: string; events: StreamEvent[]; answer: string; status: TurnStatus };

// One saved conversation in the History list.
export type ConversationSummary = { id: string; title: string; updatedAt: string; turns: number };

export type HealthInfo = {
  keyValid: boolean | null;
  freeRequestsLeft: number | null;
  freeRequestsLimit: number | null;
  isFreeTier: boolean | null;
  models: { id: string; available: boolean | null }[];
};

export type AgentsInfo = {
  routing: string;
  codeVsModel: string;
  agents: { id: AgentId; name: string; purpose: string; tools: { name: string; description: string }[] }[];
};
