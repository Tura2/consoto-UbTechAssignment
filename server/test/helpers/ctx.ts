import type { Trip } from "../../../shared/domain";
import type { ToolContext } from "../../src/tools/types";
import { fakeData } from "./fake-data";

export const BASE_TRIP: Trip = {
  team: "platform",
  region: "Europe",
  searchWindow: { from: "2027-03-16", to: "2027-03-31" },
  candidateCities: ["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"],
  city: null,
  start: null,
  days: 3,
  nights: 2,
};

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
