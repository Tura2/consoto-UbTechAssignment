import { z } from "zod";
import type { CityCost } from "../../../shared/domain";
import { getTeam, listCities, listTeams } from "../data/consoto-data";
import { fmt } from "../domain/format";
import { estimateFor, internalSource } from "./helpers";
import { defineTool, fail, ok } from "./types";

export type CostData = {
  days: number;
  nights: number;
  teamSize: number;
  rate: { value: number; date: string };
  estimates: CityCost[];
  unknownCities: string[];
};

export const budgetEstimateCost = defineTool({
  name: "budget_estimate_cost",
  description:
    "Estimate the cost per person and for the whole team, in EUR and in ILS at the latest ECB rate, for one or more cities. " +
    "Cost data exists only for Lisbon, Barcelona, Athens, Prague and Budapest. To compare destinations, pass all cities at once. " +
    'Example input: {"cities": ["Lisbon", "Prague"], "days": 3, "team": "platform"}.',
  input: z.object({
    cities: z.array(z.string().min(1)).min(1).max(5).describe('City names, for example ["Lisbon", "Prague"]'),
    days: z.number().int().min(1).max(14).describe("Trip length in days. Nights are days minus 1."),
    team: z.string().min(1).describe('Team id, for example "platform"'),
  }),
  async execute({ cities, days, team }, ctx) {
    const found = getTeam(team);
    if (!found) {
      return fail("unknown_team", `No team data for "${team}".`, `Known teams: ${listTeams().join(", ")}. Tell the user there is no data for this team.`);
    }
    const { rate, source } = await ctx.data.ecbRate(ctx.signal);
    const { estimates, unknownCities } = estimateFor(cities, days, found, rate);
    const data: CostData = { days, nights: days - 1, teamSize: found.members.length, rate, estimates, unknownCities };
    const gaps = unknownCities.map((city) => `No cost data for ${city}. Cost data exists for: ${listCities().join(", ")}.`);
    return ok(costSummary(data), data, [internalSource("costs.json"), internalSource("team.json"), source], gaps);
  },
});

function costSummary(data: CostData): string {
  const rate = `ECB ${data.rate.value} on ${data.rate.date}`;
  if (data.estimates.length === 0) return `No cost data for ${data.unknownCities.join(", ")}.`;
  if (data.estimates.length === 1) {
    const estimate = data.estimates[0];
    return `${estimate.city}, ${data.days} days: ${fmt(estimate.perPersonIls)} ILS per person, ${fmt(estimate.teamTotalIls)} ILS for ${data.teamSize} people (${rate}).`;
  }
  const prices = data.estimates.map((estimate) => estimate.perPersonIls);
  return `${data.estimates.length} cities, ${data.days} days: ${fmt(Math.min(...prices))} to ${fmt(Math.max(...prices))} ILS per person (${rate}).`;
}
