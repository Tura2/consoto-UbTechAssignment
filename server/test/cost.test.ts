import { describe, expect, it } from "vitest";
import { estimateCityCost, perPersonEur } from "../src/domain/cost";
import { fmt } from "../src/domain/format";

const LISBON = { returnFlight: 320, hotelPerNight: 140, mealsPerDay: 55, activitiesPerDay: 40 };
const BARCELONA = { returnFlight: 300, hotelPerNight: 160, mealsPerDay: 60, activitiesPerDay: 45 };
const RATE = { value: 3.431, date: "2026-10-05" };

describe("cost", () => {
  it("adds flight, hotel nights and daily meals and activities", () => {
    expect(perPersonEur(LISBON, 3, 2)).toEqual({
      breakdown: { flight: 320, hotel: 280, meals: 165, activities: 120 },
      total: 885,
    });
    expect(perPersonEur(LISBON, 4, 3).total).toBe(1120);
  });

  it("converts to shekels and rounds only the final numbers", () => {
    const cost = estimateCityCost({
      city: "Lisbon",
      rates: LISBON,
      days: 3,
      nights: 2,
      teamSize: 12,
      rate: RATE,
      budgetIlsPerPerson: 4000,
    });
    expect(cost.perPersonEur).toBe(885);
    expect(cost.perPersonIls).toBe(3036); // 885 * 3.431 = 3036.435
    expect(cost.teamTotalIls).toBe(36437); // 3036.435 * 12 = 36437.22
    expect(cost.withinBudget).toBe(true);
    expect(cost.headroomIls).toBe(964);
    expect(cost.rate).toEqual(RATE);
  });

  it("flags a city over the per-person budget", () => {
    const cost = estimateCityCost({
      city: "Barcelona",
      rates: BARCELONA,
      days: 4,
      nights: 3,
      teamSize: 12,
      rate: RATE,
      budgetIlsPerPerson: 4000,
    });
    expect(cost.perPersonEur).toBe(1200);
    expect(cost.perPersonIls).toBe(4117);
    expect(cost.withinBudget).toBe(false);
    expect(cost.headroomIls).toBe(-117);
  });

  it("formats whole numbers with separators", () => {
    expect(fmt(36437.22)).toBe("36,437");
    expect(fmt(964)).toBe("964");
  });
});
