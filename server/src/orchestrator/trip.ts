// Trip facts owned by code. The planner says what changed; this module turns it into facts.
import { z } from "zod";
import type { Trip } from "../../../shared/domain";
import { citiesInRegion, getPolicy, matchCity, normalizeTeamId } from "../data/consoto-data";
import { resolveSearchPeriod, resolveStartDay } from "../domain/dates";
import type { Conversation, RememberedAgent } from "../state/conversations";

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

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// A month named in the user's words, and which part of it. "May" counts only after "in", "of", "during",
// "early", "mid" or "late", so "we may want" is not a month.
export function periodFromMessage(message: string): TripUpdate["searchPeriod"] | null {
  const text = message.toLowerCase();
  const index = MONTHS.findIndex((month) =>
    month === "may" ? /\b(in|of|during|early|mid|late)\s+may\b/.test(text) : new RegExp(`\\b${month}\\b`).test(text),
  );
  if (index === -1) return null;
  const part = /\b(second|latter|last) half\b|\blate\b|\bend of\b/.test(text)
    ? "second_half"
    : /\bfirst half\b|\bearly\b|\b(beginning|start) of\b/.test(text)
      ? "first_half"
      : "whole";
  return { month: index + 1, part };
}

// Free models sometimes drop the search period even when asked again (seen live), and an agent would then guess
// the dates. When the trip has no dates yet, code reads the period from the user's words instead.
export function fillPeriod(update: TripUpdate, message: string, trip: Trip): TripUpdate {
  if (update.searchPeriod || trip.searchWindow) return update;
  const period = periodFromMessage(message);
  return period ? { ...update, searchPeriod: period } : update;
}

export function focusCities(trip: Trip): string[] {
  return trip.city ? [trip.city] : trip.candidateCities;
}

// The trip facts the venue list and the draft depend on. When they change, the old result is dropped.
export function depsKey(agent: RememberedAgent, trip: Trip): string {
  switch (agent) {
    case "venues":
      return JSON.stringify([trip.city, trip.team]);
    case "itinerary":
      return JSON.stringify([trip.city, trip.start?.date ?? null, trip.days, trip.team]);
  }
}

export function dropStaleFindings(conversation: Conversation): void {
  for (const agent of Object.keys(conversation.findings) as RememberedAgent[]) {
    if (conversation.findings[agent]?.depsKey !== depsKey(agent, conversation.trip)) delete conversation.findings[agent];
  }
}
