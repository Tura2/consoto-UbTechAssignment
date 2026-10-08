import type { Trip } from "../../../shared/domain";
import type { ToolContext } from "../../src/tools/types";
import { fakeData } from "./fake-data";

export const ALL_CITIES = ["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"];
export const MARCH = { from: "2027-03-16", to: "2027-03-31" };

export const BASE_TRIP: Trip = {
  team: "platform",
  region: "Europe",
  searchWindow: MARCH,
  candidateCities: ALL_CITIES,
  city: null,
  start: null,
  days: 3,
  nights: 2,
};

export const LISBON_TRIP: Trip = { ...BASE_TRIP, city: "Lisbon", start: { date: "2027-03-16", source: "assumed" } };

export function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    trip: BASE_TRIP,
    findings: { venues: null, itinerary: null },
    data: fakeData(),
    signal: new AbortController().signal,
    today: "2026-10-06",
    scratch: {},
    ...overrides,
  };
}
