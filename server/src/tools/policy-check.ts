import { z } from "zod";
import type { PolicyVerdict, Rate, Source, Trip } from "../../../shared/domain";
import { getPolicy, getTeam, listCities } from "../data/consoto-data";
import { addDays, buildWindows, describeWindow, nearestCleanWindows } from "../domain/dates";
import { checkPolicy, type PolicyInput } from "../domain/policy";
import { estimateFor, holidaysBetween, internalSource } from "./helpers";
import { defineTool, fail, ok, type ToolContext } from "./types";

const OVERALL_LABELS: Record<PolicyVerdict["overall"], string> = {
  within_policy: "Within policy",
  within_policy_if_actions: "Within policy if the listed actions are taken",
  outside_policy: "Outside policy",
  not_enough_data: "Not enough data to decide yet",
};

export const policyCheck = defineTool({
  name: "policy_check",
  description:
    "Check the current trip against Consoto's six offsite rules: length, budget, holidays, meals, accessibility and currency. " +
    "Takes no input: it reads the current trip and the latest itinerary. No agent has it: the orchestrator runs it in code " +
    "after every turn that has a city.",
  input: z.object({}),
  async execute(_input, ctx) {
    const { trip } = ctx;
    if (!trip.city) return fail("no_city", "No city chosen yet, so there is nothing to check.", "Compare destinations first, or ask which city.");
    const policy = getPolicy();
    const team = trip.team ? getTeam(trip.team) : null;
    const sources: Source[] = [internalSource("policy.json")];
    let rate: Rate | null = null;
    try {
      const fx = await ctx.data.ecbRate(ctx.signal);
      rate = fx.rate;
      sources.push(fx.source);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
    }
    const costFor = (days: number, cities: string[]) => (team && rate ? estimateFor(cities, days, team, rate).estimates : []);
    const cost = costFor(trip.days, [trip.city])[0] ?? null;
    const costAtMaxLength = trip.days > policy.maxDays ? (costFor(policy.maxDays, [trip.city])[0] ?? null) : null;
    const alternatives = cost && !cost.withinBudget ? costFor(trip.days, listCities()) : [];
    const dates = await datesCheck(trip, ctx, sources);
    const verdict = checkPolicy({
      policy,
      trip,
      cost,
      costAtMaxLength,
      alternatives,
      dates,
      itinerary: ctx.findings.itinerary?.check ?? null,
      rate,
    });
    return ok(policySummary(verdict), verdict, sources);
  },
});

// The trip's own window, plus the nearest clean windows in the search period (or two weeks either side).
async function datesCheck(trip: Trip, ctx: ToolContext, sources: Source[]): Promise<PolicyInput["dates"]> {
  if (!trip.start || !trip.city) return null;
  const start = trip.start.date;
  const end = addDays(start, trip.days - 1);
  const searchFrom = trip.searchWindow?.from ?? addDays(start, -14);
  const searchTo = trip.searchWindow?.to ?? addDays(end, 14);
  try {
    const holidays = await holidaysBetween(trip.city, start < searchFrom ? start : searchFrom, end > searchTo ? end : searchTo, ctx);
    if (!holidays) return null;
    sources.push(...holidays.sources);
    const windows = buildWindows(searchFrom, searchTo, trip.days, holidays.items);
    return { window: describeWindow(start, trip.days, holidays.items), nearestClean: nearestCleanWindows(windows, start) };
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return null;
  }
}

function policySummary(verdict: PolicyVerdict): string {
  const count = (status: string) => verdict.rules.filter((rule) => rule.status === status).length;
  return (
    `${OVERALL_LABELS[verdict.overall]}: ${count("pass")} passed, ${count("fail")} failed, ` +
    `${count("needs_action")} need action, ${count("unknown")} unknown.`
  );
}
