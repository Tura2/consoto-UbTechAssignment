import { describe, expect, it } from "vitest";
import type { Trip } from "../../shared/domain";
import type { StreamEvent } from "../../shared/events";
import { answerMentions, cityCostMatchesCode, gapMentions, planIncludes, policyRule, tripDays, weatherIsClimateAverage } from "../src/evals/graders";
import { SAYS_NO_DATA } from "../src/evals/scenarios";
import { BASE_TRIP } from "./helpers/ctx";

const trip: Trip = { ...BASE_TRIP, days: 4, nights: 3 };
const events: StreamEvent[] = [
  { type: "plan", agents: [{ agent: "budget_policy", task: "x" }], reason: "r", trip, clarify: null },
  {
    type: "card",
    card: {
      kind: "comparison",
      days: 3,
      nights: 2,
      rate: { value: 3.431, date: "2026-10-05" },
      rows: [{ city: "Lisbon", perPersonIls: 3036, teamTotalIls: 36437, withinBudget: true, cleanWindows: 5, avgHighC: 18.6, rainyDayShare: 0.28 }],
    },
  },
  {
    type: "card",
    card: { kind: "weather", city: "Lisbon", outlook: { kind: "climate_average", from: "2027-03-16", to: "2027-03-31", stats: { avgHighC: 18.6, avgLowC: 10.8, rainyDayShare: 0.28, avgRainMm: 2.1, years: [2017] }, reason: "far" } },
  },
  {
    type: "card",
    card: { kind: "policy", city: "Lisbon", verdict: { overall: "outside_policy", rules: [{ id: 1, rule: "Max 3 days", status: "fail", detail: "4 days", fix: "Shorten to 3 days and 2 nights." }] } },
  },
  { type: "tool_end", callId: "1", ok: true, summary: "No cost data for Rome.", data: {}, sources: [], gaps: ["No cost data for Rome."], cached: false, ms: 1 },
];
const input = { events, trip, answer: "It is a climate average, not a forecast." };

describe("graders", () => {
  it("pass when the outcome is right", () => {
    expect(planIncludes("budget_policy").check(input)).toBeNull();
    expect(cityCostMatchesCode("Lisbon").check(input)).toBeNull();
    expect(weatherIsClimateAverage.check(input)).toBeNull();
    expect(policyRule(1, "fail").check(input)).toBeNull();
    expect(tripDays(4).check(input)).toBeNull();
    expect(gapMentions(/Rome/).check(input)).toBeNull();
    expect(answerMentions(/not a forecast/i).check(input)).toBeNull();
  });

  it("explain what is wrong when it is not", () => {
    expect(planIncludes("venues").check(input)).toBe("missing venues (chose budget_policy)");
    expect(tripDays(3).check(input)).toBe("expected 3 days, got 4");
    expect(answerMentions(/kosher/).check(input)).toBe("the answer does not match /kosher/");
  });

  it("accept honest no-data answers and the team gap in any case", () => {
    const noTeam: StreamEvent[] = [{ type: "tool_end", callId: "2", ok: true, summary: 'No team data for "data".', data: {}, sources: [], gaps: [], cached: false, ms: 1 }];
    expect(gapMentions(/no team data/i).check({ events: noTeam, trip, answer: "" })).toBeNull();
    expect(SAYS_NO_DATA.test("There is no cost information for Rome; data only covers Lisbon.")).toBe(true);
    expect(SAYS_NO_DATA.test("I found no team data for the Data team.")).toBe(true);
    expect(SAYS_NO_DATA.test("Rome would cost 3,000 ILS.")).toBe(false);
  });
});
