import { describe, expect, it } from "vitest";
import {
  citiesInRegion,
  getCityCosts,
  getDestination,
  getPolicy,
  getTeam,
  listCities,
  listTeams,
  matchCity,
  normalizeTeamId,
  teamNeeds,
} from "../src/data/consoto-data";

describe("Consoto data", () => {
  it("finds the Platform team by id or name", () => {
    expect(normalizeTeamId(" Platform team ")).toBe("platform");
    const team = getTeam("Platform team");
    expect(team?.id).toBe("platform");
    expect(team?.members).toHaveLength(12);
  });

  it("returns null for a team it has no data for", () => {
    expect(getTeam("Data team")).toBeNull();
    expect(listTeams()).toEqual(["platform"]);
  });

  it("summarizes the team's needs", () => {
    const needs = teamNeeds(getTeam("platform")!);
    expect(needs.diets).toEqual(["vegan", "kosher", "gluten_free"]);
    expect(needs.dietCounts).toEqual({ vegan: 2, kosher: 1, gluten_free: 1 });
    expect(needs.wheelchairUsers).toBe(1);
  });

  it("reads the policy parameters", () => {
    const policy = getPolicy();
    expect(policy.maxDays).toBe(3);
    expect(policy.maxNights).toBe(2);
    expect(policy.budgetIlsPerPerson).toBe(4000);
    expect(policy.rules).toHaveLength(6);
  });

  it("matches cities case-insensitively and knows only the five cost cities", () => {
    expect(matchCity("PRAGUE")).toBe("Prague");
    expect(matchCity("Rome")).toBeNull();
    expect(getCityCosts("lisbon")).toEqual({ returnFlight: 320, hotelPerNight: 140, mealsPerDay: 55, activitiesPerDay: 40 });
    expect(listCities()).toEqual(["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"]);
  });

  it("gives country codes for holiday lookups", () => {
    expect(getDestination("barcelona")).toEqual({
      city: "Barcelona",
      countryCode: "ES",
      country: "Spain",
      subdivisionCode: "ES-CT",
      region: "Europe",
    });
    expect(getDestination("Rome")).toBeNull();
    expect(citiesInRegion("europe")).toHaveLength(5);
    expect(citiesInRegion("Asia")).toEqual([]);
  });
});
