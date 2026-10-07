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
