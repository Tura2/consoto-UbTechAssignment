// The trip bar: the current trip as short labelled values, and which values changed between two plans.
import type { Trip } from "../../shared/domain";
import { range } from "./format";

export type TripSummary = { team: string | null; place: string; dates: string | null; length: string };
export type TripField = keyof TripSummary;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Null while the plan knows nothing about the trip yet.
export function tripSummary(trip: Trip): TripSummary | null {
  if (!trip.team && !trip.city && !trip.searchWindow && trip.candidateCities.length === 0) return null;
  const place = trip.city ?? (trip.candidateCities.length > 0 ? `Comparing ${trip.candidateCities.length} cities` : "City not chosen");
  let dates: string | null = null;
  if (trip.start) dates = `${range(trip.start.date, addDays(trip.start.date, trip.days - 1))}${trip.start.source === "assumed" ? " (assumed)" : ""}`;
  else if (trip.searchWindow) dates = `${range(trip.searchWindow.from, trip.searchWindow.to)} (search window)`;
  // Team ids are lower case ("platform"); show them as names.
  const team = trip.team ? trip.team.charAt(0).toUpperCase() + trip.team.slice(1) : null;
  return { team, place, dates, length: `${trip.days} days / ${trip.nights} nights` };
}

// The trip from the most recent plan, or null before the first plan arrives.
export function latestTrip(turns: { plan: { trip: Trip } | null }[]): Trip | null {
  for (let index = turns.length - 1; index >= 0; index--) {
    const plan = turns[index].plan;
    if (plan) return plan.trip;
  }
  return null;
}

// Fields that differ from the previous summary. Nothing is reported for the first trip.
export function changedFields(previous: TripSummary | null, next: TripSummary): TripField[] {
  if (!previous) return [];
  return (Object.keys(next) as TripField[]).filter((field) => previous[field] !== next[field]);
}
