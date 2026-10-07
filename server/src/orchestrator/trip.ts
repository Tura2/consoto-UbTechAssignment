// Trip facts owned by code. The planner says what changed; this module turns it into facts.
import { z } from "zod";
import type { AgentId, Trip } from "../../../shared/domain";
import { citiesInRegion, getPolicy, matchCity, normalizeTeamId } from "../data/consoto-data";
import { resolveSearchPeriod, resolveStartDay } from "../domain/dates";
import type { Conversation } from "../state/conversations";

export const TripUpdateSchema = z.object({
  team: z.string().optional().describe('Team id or name, for example "platform"'),
  region: z.string().optional().describe('Region the user wants, for example "Europe"'),
  city: z.string().optional().describe('The city the user picked, for example "Lisbon"'),
  candidateCities: z.array(z.string()).optional().describe("Cities the user named for comparison"),
  searchPeriod: z
    .object({ month: z.number().int().min(1).max(12), part: z.enum(["whole", "first_half", "second_half"]) })
    .optional()
    .describe("When, as a month and a part of it. Never compute dates."),
  startDay: z
    .object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
    .optional()
    .describe("Only if the user names a start date"),
  days: z.number().int().min(1).max(14).optional().describe("Trip length in days, if the user states or changes it"),
});

export type TripUpdate = z.infer<typeof TripUpdateSchema>;

export function newTrip(): Trip {
  const { maxDays } = getPolicy();
  return { team: null, region: null, searchWindow: null, candidateCities: [], city: null, start: null, days: maxDays, nights: maxDays - 1 };
}

export function applyTripUpdate(trip: Trip, update: TripUpdate, today: string): Trip {
  const next: Trip = { ...trip };
  if (update.team) next.team = normalizeTeamId(update.team);
  if (update.region) {
    next.region = update.region.trim();
    if (!update.candidateCities) next.candidateCities = citiesInRegion(next.region);
  }
  if (update.candidateCities) next.candidateCities = update.candidateCities.map((city) => matchCity(city) ?? city.trim());
  if (update.searchPeriod) {
    const window = resolveSearchPeriod(update.searchPeriod, today);
    next.searchWindow = window;
    if (next.start && (next.start.date < window.from || next.start.date > window.to)) next.start = null;
  }
  if (update.city) {
    const city = matchCity(update.city) ?? update.city.trim();
    if (city !== next.city && next.start?.source === "assumed") next.start = null;
    next.city = city;
  }
  if (update.startDay) {
    const date = resolveStartDay(update.startDay, next.searchWindow, today);
    if (date) next.start = { date, source: "user" };
  }
  if (update.days) {
    next.days = update.days;
    next.nights = update.days - 1;
  }
  return next;
}

// The planner sometimes invents cities. Keep only the candidates the user typed in this message.
export function namedCandidates(update: TripUpdate, message: string): TripUpdate {
  const text = message.toLowerCase();
  const named = update.candidateCities?.filter((city) => {
    const name = city.trim().toLowerCase();
    return name !== "" && text.includes(name);
  });
  return { ...update, candidateCities: named?.length ? named : undefined };
}

export function focusCities(trip: Trip): string[] {
  return trip.city ? [trip.city] : trip.candidateCities;
}

// The trip facts each agent's result depends on. When they change, the old result is dropped.
export function depsKey(agent: AgentId, trip: Trip): string {
  switch (agent) {
    case "budget_policy":
      return JSON.stringify([focusCities(trip), trip.days, trip.team]);
    case "weather_calendar":
      return JSON.stringify([focusCities(trip), trip.searchWindow, trip.days]);
    case "venues":
      return JSON.stringify([trip.city, trip.team]);
    case "itinerary":
      return JSON.stringify([trip.city, trip.start?.date ?? null, trip.days, trip.team]);
  }
}

export function dropStaleFindings(conversation: Conversation): void {
  for (const agent of Object.keys(conversation.findings) as AgentId[]) {
    if (conversation.findings[agent]?.depsKey !== depsKey(agent, conversation.trip)) delete conversation.findings[agent];
  }
}
