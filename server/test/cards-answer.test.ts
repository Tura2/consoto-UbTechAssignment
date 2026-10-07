import { describe, expect, it } from "vitest";
import type { PolicyVerdict, Trip } from "../../shared/domain";
import type { StreamEvent } from "../../shared/events";
import type { AgentResult, ToolRun } from "../src/agents/runner";
import { ANSWER_RULES, buildAnswerContext, streamAnswer } from "../src/orchestrator/answer";
import { buildCards } from "../src/orchestrator/cards";
import { budgetEstimateCost } from "../src/tools/budget-estimate-cost";
import { calendarFindCleanWindows } from "../src/tools/calendar-find-clean-windows";
import { itinerarySubmitPlan } from "../src/tools/itinerary-submit-plan";
import { placesFindForTeam } from "../src/tools/places-find-for-team";
import { runTool, type AnyTool } from "../src/tools/types";
import { weatherGetOutlook } from "../src/tools/weather-get-outlook";
import { BASE_TRIP, makeCtx } from "./helpers/ctx";
import { scriptedLlm } from "./helpers/fake-llm";
import { GOOD_PLAN, lisbonVenues } from "./helpers/lisbon";

const ALL = ["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"];
const MARCH = { from: "2027-03-16", to: "2027-03-31" };
const LISBON_TRIP: Trip = { ...BASE_TRIP, city: "Lisbon", start: { date: "2027-03-16", source: "assumed" } };

async function run(tool: AnyTool, input: unknown, trip: Trip = BASE_TRIP): Promise<ToolRun> {
  const ctx = makeCtx({ trip, findings: { venues: lisbonVenues(), itinerary: null } });
  return { tool: tool.name, input, result: await runTool(tool, input, ctx) };
}

function agentResult(agent: AgentResult["agent"], toolRuns: ToolRun[]): AgentResult {
  return { agent, status: "ok", summary: `${agent} done`, toolRuns };
}

const VERDICT: PolicyVerdict = { overall: "within_policy", rules: [] };

describe("buildCards", () => {
  it("joins cost, holidays and weather for several cities into one comparison", async () => {
    const results = [
      agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ALL, days: 3, team: "platform" })]),
      agentResult("weather_calendar", [
        await run(calendarFindCleanWindows, { cities: ALL, ...MARCH, days: 3 }),
        await run(weatherGetOutlook, { cities: ALL, ...MARCH }),
      ]),
    ];
    const cards = buildCards({ results, policy: null, showPolicy: false, trip: BASE_TRIP });
    expect(cards.map((card) => card.kind)).toEqual(["comparison"]);
    const comparison = cards[0];
    if (comparison.kind !== "comparison") throw new Error("expected a comparison card");
    expect(comparison.rows.map((row) => row.city)).toEqual(["Athens", "Budapest", "Prague", "Lisbon", "Barcelona"]);
    expect(comparison.rows.find((row) => row.city === "Lisbon")).toMatchObject({ perPersonIls: 3036, cleanWindows: 5, avgHighC: 18 });
    expect(comparison.rate).toEqual({ value: 3.431, date: "2026-10-05" });
  });

  it("shows detail cards for one city", async () => {
    const results = [
      agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ["Lisbon"], days: 3, team: "platform" })]),
      agentResult("weather_calendar", [
        await run(calendarFindCleanWindows, { cities: ["Lisbon"], ...MARCH, days: 3 }),
        await run(weatherGetOutlook, { cities: ["Lisbon"], ...MARCH }),
      ]),
    ];
    const cards = buildCards({ results, policy: VERDICT, showPolicy: true, trip: LISBON_TRIP });
    expect(cards.map((card) => card.kind)).toEqual(["cost", "dates", "weather", "policy"]);
  });

  it("builds the chosen city's cards even when the tools returned every city", async () => {
    const results = [
      agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ALL, days: 3, team: "platform" })]),
      agentResult("weather_calendar", [
        await run(calendarFindCleanWindows, { cities: ALL, ...MARCH, days: 3 }),
        await run(weatherGetOutlook, { cities: ALL, ...MARCH }),
      ]),
    ];
    const cards = buildCards({ results, policy: null, showPolicy: false, trip: LISBON_TRIP });
    expect(cards.map((card) => card.kind)).toEqual(["cost", "dates", "weather"]);
    expect(cards.map((card) => (card.kind === "cost" ? card.estimate.city : card.kind === "dates" || card.kind === "weather" ? card.city : ""))).toEqual(["Lisbon", "Lisbon", "Lisbon"]);
  });

  it("builds the comparison card only when no city is chosen", async () => {
    const results = [agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ALL, days: 3, team: "platform" })])];
    expect(buildCards({ results, policy: null, showPolicy: false, trip: BASE_TRIP }).map((card) => card.kind)).toEqual(["comparison"]);
    expect(buildCards({ results, policy: null, showPolicy: false, trip: LISBON_TRIP }).map((card) => card.kind)).toEqual(["cost"]);
  });

  it("adds venues and the itinerary with place names", async () => {
    const results = [
      agentResult("venues", [await run(placesFindForTeam, { city: "Lisbon", team: "platform" })]),
      agentResult("itinerary", [await run(itinerarySubmitPlan, GOOD_PLAN, LISBON_TRIP)]),
    ];
    const cards = buildCards({ results, policy: null, showPolicy: false, trip: LISBON_TRIP });
    expect(cards.map((card) => card.kind)).toEqual(["venues", "itinerary"]);
    const itinerary = cards[1];
    if (itinerary.kind === "itinerary") expect(itinerary.placeNames["node/6124516487"]).toBe("Organi Chiado");
  });

  it("shows the policy card when asked, or whenever the plan is outside policy", () => {
    const outside: PolicyVerdict = { overall: "outside_policy", rules: [] };
    expect(buildCards({ results: [], policy: VERDICT, showPolicy: false, trip: LISBON_TRIP })).toEqual([]);
    expect(buildCards({ results: [], policy: outside, showPolicy: false, trip: LISBON_TRIP }).map((c) => c.kind)).toEqual(["policy"]);
  });
});

describe("answer", () => {
  it("tells the model to name sources, not tools", () => {
    expect(ANSWER_RULES).toContain("Never write tool names");
  });

  it("builds a compact context with summaries, gaps and failures", async () => {
    const results = [
      agentResult("weather_calendar", [await run(calendarFindCleanWindows, { cities: ["Lisbon"], ...MARCH, days: 3 })]),
      agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ["Rome"], days: 3, team: "platform" })]),
      agentResult("venues", [
        {
          tool: "places_find_for_team",
          input: {},
          result: { ok: false, summary: "down", error: { code: "source_unavailable", message: "Overpass is down", hint: "" } },
        },
      ]),
    ];
    const plan = { tripUpdate: {}, agents: [], reason: "Because." };
    const context = buildAnswerContext({ trip: LISBON_TRIP, plan, results, policy: null });
    const parsed = JSON.parse(context);
    expect(parsed.orchestratorReason).toBe("Because.");
    expect(parsed.tripStartAssumed).toBe(true);
    expect(context).toContain("2027-03-16 to 2027-03-18 (Tue-Wed-Thu)");
    expect(context).toContain("No cost data for Rome");
    expect(context).toContain("Overpass is down");
    expect(context).not.toContain('"windows"');
  });

  it("names the headroom as per person", async () => {
    const results = [agentResult("budget_policy", [await run(budgetEstimateCost, { cities: ["Lisbon"], days: 3, team: "platform" })])];
    const context = buildAnswerContext({ trip: LISBON_TRIP, plan: { tripUpdate: {}, agents: [], reason: "Because." }, results, policy: null });
    expect(context).toContain('"headroomIlsPerPerson": 964');
  });

  it("streams the answer as answer_delta events", async () => {
    const { llm } = scriptedLlm({}, "Lisbon works.");
    const events: StreamEvent[] = [];
    const text = await streamAnswer({ llm, history: [], message: "Where?", context: "{}", signal: new AbortController().signal, emit: (e) => events.push(e) });
    expect(text).toBe("Lisbon works.");
    expect(events).toContainEqual({ type: "answer_delta", text: "Lisbon works." });
  });
});
