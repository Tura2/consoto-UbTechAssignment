import { describe, expect, it } from "vitest";
import { toChatTool } from "../src/llm/schema";
import { FALLBACK_PLAN, PlanSchema, makePlan, parsePlan, plannerSystemPrompt } from "../src/orchestrator/plan";
import { newTrip } from "../src/orchestrator/trip";
import { scriptedLlm, text, toolCall } from "./helpers/fake-llm";

const VALID = {
  tripUpdate: { team: "platform", region: "Europe", searchPeriod: { month: 3, part: "second_half" }, days: 3 },
  agents: [
    { agent: "budget_policy", task: "Compare costs for the five cities, 3 days, platform team." },
    { agent: "weather_calendar", task: "Holidays and weather for the five cities, 2027-03-16 to 2027-03-31." },
  ],
  reason: "You asked where to go, so I compare cost, holidays and weather.",
};

const args = (llm: ReturnType<typeof scriptedLlm>["llm"]) => ({
  llm,
  history: [],
  message: "Where should we go?",
  trip: newTrip(),
  today: "2026-10-06",
  signal: new AbortController().signal,
  emit: () => {},
});

describe("parsePlan", () => {
  it("accepts a plan with no agents when it says so explicitly", () => {
    const result = parsePlan(JSON.stringify({ tripUpdate: {}, agents: [], reason: "Just a greeting." }));
    expect(result).toEqual({ success: true, plan: { tripUpdate: {}, agents: [], reason: "Just a greeting." } });
  });

  it("rejects a plan that leaves out agents or tripUpdate, so the model is asked again", () => {
    // A real reply: the model put the task into clarify and sent no agents.
    const result = parsePlan(JSON.stringify({ reason: "You confirmed Lisbon.", clarify: "I'll draft the 3 days in Lisbon." }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/agents/);
    expect(parsePlan(JSON.stringify({ agents: [], reason: "Hi." })).success).toBe(false);
  });

  it("tells the model that tripUpdate and agents are required", () => {
    expect(toChatTool("submit_plan", "plan", PlanSchema)).toMatchObject({
      function: { parameters: { required: expect.arrayContaining(["tripUpdate", "agents", "reason"]) } },
    });
  });

  it("explains what is wrong", () => {
    const result = parsePlan(JSON.stringify({ ...VALID, agents: [{ agent: "travel_agent", task: "x" }] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("agent");
    expect(parsePlan("{not json").success).toBe(false);
  });
});

describe("makePlan", () => {
  it("returns the plan from submit_plan", async () => {
    const { llm } = scriptedLlm({ planner: [toolCall("submit_plan", VALID)] });
    const plan = await makePlan(args(llm));
    expect(plan.agents.map((a) => a.agent)).toEqual(["budget_policy", "weather_calendar"]);
  });

  it("gives the model one more chance after an invalid plan", async () => {
    const { llm, calls } = scriptedLlm({ planner: [toolCall("submit_plan", { reason: "" }), toolCall("submit_plan", VALID)] });
    const plan = await makePlan(args(llm));
    expect(calls).toEqual(["planner", "planner"]);
    expect(plan.reason).toBe(VALID.reason);
  });

  it("asks once more when the plan only asks for something the trip already has", async () => {
    // A real reply on the free model: message 1 asked "Which European cities?" although code fills the region's cities.
    const asks = { tripUpdate: VALID.tripUpdate, agents: [], reason: "Need the cities.", clarify: "Which European cities would you like to consider?" };
    const { llm, calls, requests } = scriptedLlm({ planner: [toolCall("submit_plan", asks), toolCall("submit_plan", VALID)] });
    const plan = await makePlan({ ...args(llm), message: "Somewhere in Europe, second half of March. Where should we go?" });
    expect(calls).toEqual(["planner", "planner"]);
    expect(JSON.stringify(requests[1].messages.at(-1))).toContain("Do not ask");
    expect(plan.agents).toHaveLength(2);
  });

  it("keeps the trip facts of the first attempt when the second sends only its corrections", async () => {
    const asks = { tripUpdate: VALID.tripUpdate, agents: [], reason: "Need the cities.", clarify: "Which cities?" };
    const corrected = { tripUpdate: {}, agents: VALID.agents, reason: VALID.reason };
    const { llm } = scriptedLlm({ planner: [toolCall("submit_plan", asks), toolCall("submit_plan", corrected)] });
    const plan = await makePlan({ ...args(llm), message: "Somewhere in Europe, second half of March. Where should we go?" });
    expect(plan.tripUpdate).toEqual(VALID.tripUpdate);
    expect(plan.agents).toHaveLength(2);
  });

  it("keeps the first plan when the second attempt fails", async () => {
    const asks = { tripUpdate: VALID.tripUpdate, agents: [], reason: "Need the cities.", clarify: "Which cities?" };
    const { llm, calls } = scriptedLlm({ planner: [toolCall("submit_plan", asks), text("Sorry.")] });
    const plan = await makePlan({ ...args(llm), message: "Somewhere in Europe, second half of March. Where should we go?" });
    expect(calls).toEqual(["planner", "planner"]);
    expect(plan.clarify).toBe("Which cities?");
  });

  it("accepts a plan without a search period at once (code reads the month from the message)", async () => {
    const { llm, calls } = scriptedLlm({ planner: [toolCall("submit_plan", { ...VALID, tripUpdate: {} })] });
    await makePlan(args(llm));
    expect(calls).toEqual(["planner"]);
  });

  it("asks the user to rephrase when the model never calls submit_plan", async () => {
    const { llm } = scriptedLlm({ planner: [text("Lisbon!"), text("Really, Lisbon.")] });
    expect(await makePlan(args(llm))).toEqual(FALLBACK_PLAN);
  });
});

describe("plannerSystemPrompt", () => {
  it("lists every agent, the routing rules, today and the trip", () => {
    const prompt = plannerSystemPrompt(newTrip(), "2026-10-06");
    for (const id of ["budget_policy", "weather_calendar", "venues", "itinerary"]) expect(prompt).toContain(id);
    expect(prompt).toContain("Never compute dates");
    expect(prompt).toContain("Never ask the user to choose dates");
    expect(prompt).toContain("set tripUpdate.city");
    expect(prompt).toContain("candidateCities holds only cities the user named");
    expect(prompt).toContain("Today is 2026-10-06");
  });
});
