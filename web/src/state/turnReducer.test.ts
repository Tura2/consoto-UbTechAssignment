import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../../shared/events";
import { applyEvent, newTurn, turnFromEvents } from "./turnReducer";

const TRIP = { team: "Platform", region: null, searchWindow: null, candidateCities: [], city: "Lisbon", start: null, days: 3, nights: 2 };
const replay = (events: StreamEvent[], now: number) => events.reduce((turn, event) => applyEvent(turn, event, now), newTurn("local-1", "Can everyone eat?", now));

const EVENTS: StreamEvent[] = [
  { type: "turn_start", conversationId: "c1", turnId: "t1" },
  { type: "plan", agents: [{ agent: "venues", task: "Food" }], reason: "Food question.", trip: TRIP, clarify: null, ms: 12000 },
  { type: "agent_start", agent: "venues", task: "Food" },
  { type: "llm_call", who: "venues", model: "m1", attempt: 1, status: "rate_limited", ms: 5, detail: "429", tokens: null },
  { type: "llm_call", who: "venues", model: "m2", attempt: 2, status: "ok", ms: 900, detail: null, tokens: null },
  { type: "tool_start", callId: "x", owner: "venues", tool: "places_find_for_team", input: { city: "Lisbon" } },
  { type: "tool_end", callId: "x", ok: true, summary: "5 places", data: {}, sources: [], gaps: ["No kosher"], cached: true, ms: 40 },
  { type: "agent_end", agent: "venues", status: "ok", summary: "Found places.", ms: 700 },
  { type: "answer_delta", text: "Here " },
  { type: "answer_delta", text: "you go." },
  { type: "turn_end", status: "done", llmCalls: 3, ms: 2500, error: null },
];

describe("turnReducer", () => {
  it("builds the turn view from the event stream", () => {
    const turn = replay(EVENTS, 1000);
    expect(turn.id).toBe("t1");
    expect(turn.plan).toMatchObject({ reason: "Food question.", ms: 12000, trip: TRIP });
    expect(turn.agents).toEqual([{ agent: "venues", task: "Food", status: "ok", summary: "Found places.", startedAt: 1000, ms: 700 }]);
    expect(turn.steps[0]).toMatchObject({ status: "ok", summary: "5 places", gaps: ["No kosher"], cached: true, ms: 40 });
    expect(turn.llm.map((c) => c.status)).toEqual(["rate_limited", "ok"]);
    expect(turn.answer).toBe("Here you go.");
    expect(turn).toMatchObject({ status: "done", llmCalls: 3, ms: 2500 });
  });

  it("marks unfinished work when a turn is stopped", () => {
    const partial = EVENTS.slice(0, 6);
    const stopped = applyEvent(replay(partial, 1000), { type: "turn_end", status: "stopped", llmCalls: 2, ms: 10, error: null }, 2000);
    expect(stopped.agents[0].status).toBe("error");
    expect(stopped.steps[0]).toMatchObject({ status: "error", summary: "Stopped" });
  });

  it("rebuilds a stored turn and trusts the stored status", () => {
    const turn = turnFromEvents("t1", "Hi", EVENTS.slice(0, 3), "stopped");
    expect(turn.status).toBe("stopped");
  });
});
