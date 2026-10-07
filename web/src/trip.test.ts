import { describe, expect, it } from "vitest";
import type { Trip } from "../../shared/domain";
import { changedFields, latestTrip, tripSummary } from "./trip";

const TRIP: Trip = { team: "Platform", region: "Europe", searchWindow: { from: "2027-03-16", to: "2027-03-31" }, candidateCities: ["Lisbon", "Prague"], city: null, start: null, days: 3, nights: 2 };

describe("tripSummary", () => {
  it("is null until the plan knows something about the trip", () => {
    expect(tripSummary({ ...TRIP, team: null, searchWindow: null, candidateCities: [] })).toBeNull();
  });

  it("compares cities and shows the search window before a city and dates exist", () => {
    expect(tripSummary(TRIP)).toEqual({ team: "Platform", place: "Comparing 2 cities", dates: "16 Mar to 31 Mar (search window)", length: "3 days / 2 nights" });
  });

  it("shows the start and end dates, marking an assumed start", () => {
    const summary = tripSummary({ ...TRIP, city: "Lisbon", start: { date: "2027-03-19", source: "assumed" } });
    expect(summary).toMatchObject({ place: "Lisbon", dates: "19 Mar to 21 Mar (assumed)" });
  });
});

describe("latestTrip", () => {
  it("takes the trip of the most recent turn that has a plan", () => {
    const older = { ...TRIP, city: "Lisbon" };
    expect(latestTrip([{ plan: { trip: older } }, { plan: null }])).toBe(older);
    expect(latestTrip([{ plan: null }])).toBeNull();
  });
});

describe("changedFields", () => {
  it("reports nothing for the first trip and the fields that changed after", () => {
    const before = tripSummary(TRIP)!;
    const after = tripSummary({ ...TRIP, city: "Prague", days: 4, nights: 3 })!;
    expect(changedFields(null, before)).toEqual([]);
    expect(changedFields(before, after)).toEqual(["place", "length"]);
  });
});
