import { describe, expect, it } from "vitest";
import type { PolicyVerdict } from "../../shared/domain";
import type { Card, StreamEvent } from "../../shared/events";
import { LlmError, type Llm } from "../src/llm/openrouter";
import { newTrip } from "../src/orchestrator/trip";
import { runTurn, type TurnDeps } from "../src/orchestrator/turn";
import { createStore } from "../src/state/conversations";
import { BASE_TRIP } from "./helpers/ctx";
import { fakeData } from "./helpers/fake-data";
import { scriptedLlm, text, toolCall, toolCalls } from "./helpers/fake-llm";
import { GOOD_PLAN } from "./helpers/lisbon";

const ALL = ["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"];
const MARCH = { from: "2027-03-16", to: "2027-03-31" };

const deps = (llm: Llm, data = fakeData()): TurnDeps => ({ llm, data, today: () => "2026-10-06" });
const cardsOf = (events: StreamEvent[]): Card[] => events.flatMap((e) => (e.type === "card" ? [e.card] : []));

async function turnWith(llm: Llm, message: string, setup?: (c: ReturnType<ReturnType<typeof createStore>["getOrCreate"]>) => void, data = fakeData()) {
  const conversation = createStore(newTrip).getOrCreate();
  setup?.(conversation);
  const events: StreamEvent[] = [];
  const turn = await runTurn(conversation, message, deps(llm, data), (e) => events.push(e), new AbortController().signal);
  return { conversation, events, turn };
}

const M1_PLAN = {
  tripUpdate: { team: "platform", region: "Europe", searchPeriod: { month: 3, part: "second_half" }, days: 3 },
  agents: [
    { agent: "budget_policy", task: "Compare costs for all five cities." },
    { agent: "weather_calendar", task: "Holidays and weather for all five cities." },
  ],
  reason: "You asked where to go, so I compare cost, holidays and weather.",
};

describe("runTurn", () => {
  it("message 1: compares five cities with numbers from code", async () => {
    const { llm } = scriptedLlm(
      {
        planner: [toolCall("submit_plan", M1_PLAN)],
        budget_policy: [toolCall("budget_estimate_cost", { cities: ALL, days: 3, team: "platform" }), text("Athens and Budapest are cheapest.")],
        weather_calendar: [
          toolCalls([
            { name: "calendar_find_clean_windows", args: { cities: ALL, ...MARCH, days: 3 } },
            { name: "weather_get_outlook", args: { cities: ALL, ...MARCH } },
          ]),
          text("Lisbon is warmest."),
        ],
      },
      "Lisbon looks best.",
    );
    const { conversation, events, turn } = await turnWith(llm, "Where should we go?");
    expect(turn.status).toBe("done");
    expect(turn.answer).toBe("Lisbon looks best.");
    expect(conversation.trip.searchWindow).toEqual(MARCH);
    expect(conversation.findings).toEqual({}); // later turns reuse only the venue list and the draft
    const comparison = cardsOf(events).find((card) => card.kind === "comparison");
    expect(comparison?.kind === "comparison" && comparison.rows.find((r) => r.city === "Lisbon")).toMatchObject({ perPersonIls: 3036, cleanWindows: 5 });
    expect(cardsOf(events).some((card) => card.kind === "policy")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "done", llmCalls: 6 });
  });

  it("message 3: assumes dates, adds the venue search and runs the policy check in code", async () => {
    const { llm } = scriptedLlm({
      planner: [
        toolCall("submit_plan", {
          tripUpdate: {},
          agents: [
            { agent: "budget_policy", task: "Total for Lisbon." },
            { agent: "itinerary", task: "Draft the 3 days in Lisbon." },
          ],
          reason: "You asked for a plan, the total and the policy.",
        }),
      ],
      venues: [toolCall("places_find_for_team", { city: "Lisbon", team: "platform" }), text("Found places.")],
      budget_policy: [toolCall("budget_estimate_cost", { cities: ["Lisbon"], days: 3, team: "platform" }), text("3,036 ILS per person.")],
      itinerary: [toolCall("itinerary_submit_plan", GOOD_PLAN), text("Drafted.")],
    });
    const { conversation, events } = await turnWith(llm, "Draft the 3 days.", (c) => {
      c.trip = { ...BASE_TRIP, city: "Lisbon" };
    });
    expect(conversation.trip.start).toEqual({ date: "2027-03-16", source: "assumed" });
    const byCode = events.filter((e) => e.type === "tool_start" && e.owner === "orchestrator").map((e) => (e.type === "tool_start" ? e.tool : ""));
    expect(byCode).toEqual(["calendar_find_clean_windows", "policy_check"]);
    const started = events.filter((e) => e.type === "agent_start").map((e) => (e.type === "agent_start" ? e.agent : ""));
    expect(started.at(-1)).toBe("itinerary");
    expect(started).toContain("venues");
    expect(cardsOf(events).map((card) => card.kind)).toEqual(["cost", "venues", "itinerary", "policy"]);
    const policy = cardsOf(events).find((card) => card.kind === "policy");
    expect(policy?.kind === "policy" && (policy.verdict as PolicyVerdict).overall).toBe("within_policy_if_actions");
  });

  it("asks a clarifying question without running agents", async () => {
    const { llm, calls } = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "I need the team.", clarify: "Which team is this offsite for?" })],
    });
    const { events, turn } = await turnWith(llm, "Plan an offsite.");
    expect(turn.answer).toBe("Which team is this offsite for?");
    expect(events.some((e) => e.type === "agent_start")).toBe(false);
    expect(calls).toEqual(["planner"]);
  });

  it("reads the search period from the user's words when the plan leaves it out", async () => {
    const noPeriod = { ...M1_PLAN, tripUpdate: { team: "platform", region: "Europe", days: 3 }, agents: [{ agent: "budget_policy", task: "Compare." }] };
    const { llm } = scriptedLlm({ planner: [toolCall("submit_plan", noPeriod)], budget_policy: [text("Compared.")] });
    const { conversation } = await turnWith(llm, "Somewhere in Europe, second half of March. Where should we go?");
    expect(conversation.trip.searchWindow).toEqual(MARCH);
  });

  it("tells the comparison agents the trip's cities, whatever cities the planner wrote in the task", async () => {
    // Seen live: on message 1 the planner wrote tasks for "Lisbon, Prague, Barcelona, and Amsterdam".
    const guessed = { ...M1_PLAN, agents: [{ agent: "budget_policy", task: "Compare Lisbon, Prague, Barcelona and Amsterdam." }] };
    const { llm, requests } = scriptedLlm({ planner: [toolCall("submit_plan", guessed)], budget_policy: [text("Compared.")] });
    await turnWith(llm, "Where should we go?");
    const task = requests.find((request) => request.who === "budget_policy")!.messages.at(-1)!.content;
    expect(task).toContain("Use exactly these cities from the trip: Lisbon, Barcelona, Athens, Prague, Budapest.");
  });

  it("runs the agents when the plan names agents and also asks a question", async () => {
    // A real reply: message 1 routed to both comparison agents and also asked "Which cities?".
    const { llm } = scriptedLlm({
      planner: [toolCall("submit_plan", { ...M1_PLAN, clarify: "Which European cities would you like us to compare?" })],
      budget_policy: [text("Costs compared.")],
      weather_calendar: [text("Weather compared.")],
    });
    const { events, turn } = await turnWith(llm, "Where should we go?");
    expect(events.filter((e) => e.type === "agent_start").map((e) => (e.type === "agent_start" ? e.agent : ""))).toEqual(["budget_policy", "weather_calendar"]);
    expect(events).toContainEqual(expect.objectContaining({ type: "plan", clarify: null }));
    expect(turn.answer).not.toContain("Which European cities");
  });

  it("reports an Overpass outage instead of inventing venues", async () => {
    const { llm, requests } = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [{ agent: "venues", task: "Food in Lisbon." }], reason: "Food question." })],
      venues: [toolCall("places_find_for_team", { city: "Lisbon", team: "platform" }), text("The map service is down.")],
    });
    const down = fakeData({ overpass: async () => { throw new Error("OpenStreetMap (Overpass): HTTP 504"); } });
    const { events } = await turnWith(llm, "Can everyone eat?", (c) => { c.trip = { ...BASE_TRIP, city: "Lisbon" }; }, down);
    expect(events.find((e) => e.type === "tool_end" && e.callId && !e.ok)).toBeDefined();
    expect(cardsOf(events).some((card) => card.kind === "venues")).toBe(false);
    const answerRequest = requests.find((r) => r.who === "answer");
    expect(JSON.stringify(answerRequest?.messages)).toContain("HTTP 504");
  });

  it("handles an itinerary request with no city or dates", async () => {
    const noDates = { tripUpdate: {}, agents: [{ agent: "itinerary", task: "Draft a plan." }], reason: "You asked for a plan." };
    const { llm } = scriptedLlm({
      planner: [toolCall("submit_plan", noDates)],
      itinerary: [toolCall("itinerary_submit_plan", GOOD_PLAN), text("I need a city first.")],
    });
    const { events, turn } = await turnWith(llm, "Draft our offsite plan.");
    expect(turn.status).toBe("done");
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", ok: false, summary: "There is no venue list for this city yet." }));
    expect(cardsOf(events)).toEqual([]);
  });

  it("keeps the partial answer when the stream breaks", async () => {
    const llm: Llm = {
      complete: async () => ({ message: toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Greeting." }), model: "fake" }),
      stream: async (_request, _emit, onText) => {
        onText("Partial ");
        throw new LlmError("The answer was interrupted: socket closed", "interrupted");
      },
    };
    const { events, turn } = await turnWith(llm, "Hi");
    expect(turn.status).toBe("error");
    expect(turn.answer).toBe("Partial ");
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "error", error: expect.stringContaining("interrupted") });
  });

  it("stops when the user aborts", async () => {
    const controller = new AbortController();
    const llm: Llm = {
      complete: async () => {
        controller.abort();
        throw new Error("aborted");
      },
      stream: async () => ({ text: "", model: "" }),
    };
    const conversation = createStore(newTrip).getOrCreate();
    const events: StreamEvent[] = [];
    const turn = await runTurn(conversation, "Hi", deps(llm), (e) => events.push(e), controller.signal);
    expect(turn.status).toBe("stopped");
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "stopped", error: null });
  });

  it("remembers earlier turns", async () => {
    const { llm, requests } = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Greeting." }), toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Follow-up." })],
    }, "Noted.");
    const conversation = createStore(newTrip).getOrCreate();
    await runTurn(conversation, "We like Lisbon.", deps(llm), () => {}, new AbortController().signal);
    await runTurn(conversation, "What did I say?", deps(llm), () => {}, new AbortController().signal);
    const secondPlanner = requests.filter((r) => r.who === "planner")[1];
    expect(secondPlanner.messages).toContainEqual({ role: "user", content: "We like Lisbon." });
    expect(secondPlanner.messages).toContainEqual({ role: "assistant", content: "Noted." });
  });

  it("keeps a successful tool result when the agent fails afterwards", async () => {
    const { llm } = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [{ agent: "itinerary", task: "Draft" }], reason: "You asked for a plan." })],
      venues: [toolCall("places_find_for_team", { city: "Lisbon", team: "platform" })],
      itinerary: [toolCall("itinerary_submit_plan", GOOD_PLAN), text("Drafted.")],
    });
    const { conversation, events } = await turnWith(llm, "Draft the 3 days.", (c) => {
      c.trip = { ...BASE_TRIP, city: "Lisbon" };
    });
    expect(events.some((e) => e.type === "tool_end" && !e.ok)).toBe(false);
    expect(cardsOf(events).some((card) => card.kind === "itinerary")).toBe(true);
    expect(conversation.findings.venues).toBeDefined();
  });

  it("a stopped turn does not assume a start date", async () => {
    const controller = new AbortController();
    const { llm } = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [{ agent: "budget_policy", task: "Total" }], reason: "Cost." })],
    });
    const base = fakeData();
    const data = fakeData({
      israelHolidays: async (from, to, signal) => {
        controller.abort();
        return base.israelHolidays(from, to, signal);
      },
    });
    const conversation = createStore(newTrip).getOrCreate();
    conversation.trip = { ...BASE_TRIP, city: "Lisbon" };
    const turn = await runTurn(conversation, "Total?", deps(llm, data), () => {}, controller.signal);
    expect(turn.status).toBe("stopped");
    expect(conversation.trip.start).toBeNull();
  });

  it("stores the cleaned answer on the turn", async () => {
    const { llm } = scriptedLlm({ planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Greeting." })] }, "Lisbon \u2013 sunny \u3010budget_estimate_cost\u3011.");
    const { turn } = await turnWith(llm, "Hi");
    expect(turn.answer).toBe("Lisbon - sunny.");
  });

  it("ignores events that arrive after turn_end", async () => {
    let lateEmit: Parameters<Llm["complete"]>[1] = () => {};
    const llm: Llm = {
      complete: async (_request, emit) => {
        lateEmit = emit;
        return { message: toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Greeting." }), model: "fake" };
      },
      stream: async () => ({ text: "", model: "" }),
    };
    const { events } = await turnWith(llm, "Hi");
    const count = events.length;
    lateEmit({ type: "llm_call", who: "planner", model: "fake", attempt: 1, status: "ok", ms: 1, detail: null, tokens: null });
    expect(events).toHaveLength(count);
    expect(events.at(-1)?.type).toBe("turn_end");
  });

  it("gives the itinerary writer the current draft so a change request edits it", async () => {
    const first = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [{ agent: "itinerary", task: "Draft" }], reason: "You asked for a plan." })],
      venues: [toolCall("places_find_for_team", { city: "Lisbon", team: "platform" }), text("Found places.")],
      itinerary: [toolCall("itinerary_submit_plan", GOOD_PLAN), text("Drafted.")],
    });
    const { conversation } = await turnWith(first.llm, "Draft the 3 days.", (c) => {
      c.trip = { ...BASE_TRIP, city: "Lisbon" };
    });
    const second = scriptedLlm({
      planner: [toolCall("submit_plan", { tripUpdate: {}, agents: [{ agent: "itinerary", task: "Swap day 2 dinner" }], reason: "You asked for a change." })],
      itinerary: [toolCall("itinerary_submit_plan", GOOD_PLAN), text("Changed.")],
    });
    await runTurn(conversation, "Swap day 2 dinner.", deps(second.llm), () => {}, new AbortController().signal);
    expect(JSON.stringify(second.requests.find((r) => r.who === "itinerary")?.messages)).toContain("Current draft");
    expect(JSON.stringify(first.requests.find((r) => r.who === "itinerary")?.messages)).not.toContain("Current draft");
  });
});
