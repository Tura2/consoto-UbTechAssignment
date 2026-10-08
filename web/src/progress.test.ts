import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../shared/events";
import { progressSteps } from "./progress";
import { applyEvent, newTurn } from "./state/turnReducer";

const TRIP = { team: "Platform", region: null, searchWindow: null, candidateCities: [], city: "Lisbon", start: null, days: 3, nights: 2 };
const label = (agent: string) => agent;

function turnAfter(events: StreamEvent[]) {
  return events.reduce((turn, event) => applyEvent(turn, event, 1000), newTurn("t", "hi", 1000));
}
const PLAN: StreamEvent = { type: "plan", agents: [{ agent: "venues", task: "x" }, { agent: "itinerary", task: "y" }], reason: "r", trip: TRIP, ms: 12000 };

describe("progressSteps", () => {
  it("shows the plan running before the plan event", () => {
    const steps = progressSteps(turnAfter([]), label);
    expect(steps.map((s) => [s.key, s.state])).toEqual([["plan", "running"], ["answer", "waiting"]]);
  });

  it("shows running and waiting agents with the plan duration", () => {
    const steps = progressSteps(turnAfter([PLAN, { type: "agent_start", agent: "venues" }]), label);
    expect(steps.map((s) => s.state)).toEqual(["done", "running", "waiting", "waiting"]);
    expect(steps[0].ms).toBe(12000);
  });

  it("adds the policy check only when it ran and starts the answer after the agents", () => {
    const steps = progressSteps(
      turnAfter([
        PLAN,
        { type: "agent_start", agent: "venues" },
        { type: "agent_end", agent: "venues", status: "ok", summary: "", ms: 500 },
        { type: "agent_start", agent: "itinerary" },
        { type: "agent_end", agent: "itinerary", status: "timeout", summary: "", ms: 900 },
        { type: "tool_start", callId: "p", owner: "orchestrator", tool: "policy_check", input: {} },
        { type: "tool_end", callId: "p", ok: true, summary: "", data: {}, sources: [], gaps: [], cached: false, ms: 3 },
      ]),
      label,
    );
    expect(steps.map((s) => [s.key, s.state])).toEqual([["plan", "done"], ["venues", "done"], ["itinerary", "failed"], ["policy", "done"], ["answer", "running"]]);
    expect(steps[1].ms).toBe(500);
  });

  it("fails unfinished steps when the turn is stopped", () => {
    const steps = progressSteps(turnAfter([PLAN, { type: "turn_end", status: "stopped", llmCalls: 1, ms: 5, error: null }]), label);
    expect(steps.map((s) => s.state)).toEqual(["done", "failed", "failed", "failed"]);
  });
});
