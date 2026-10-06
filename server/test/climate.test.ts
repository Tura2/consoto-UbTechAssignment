import { describe, expect, it } from "vitest";
import { climateStats, climateYears, shiftYear, windowInYear } from "../src/domain/climate";
import { parseArchive } from "../src/clients/open-meteo";
import archive from "./fixtures/archive-lisbon-2025.json";

describe("climate", () => {
  it("picks the last 10 years with complete archive data", () => {
    expect(climateYears("2027-03-16", "2027-03-31", "2026-10-06")).toEqual([
      2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026,
    ]);
    // On 2026-03-30 the 2026 window has not been archived yet.
    expect(climateYears("2027-03-16", "2027-03-31", "2026-03-30")[9]).toBe(2025);
  });

  it("moves a window into another year, including across New Year and leap days", () => {
    expect(windowInYear("2027-03-16", "2027-03-31", 2019)).toEqual({ from: "2019-03-16", to: "2019-03-31" });
    expect(windowInYear("2027-12-30", "2028-01-02", 2020)).toEqual({ from: "2019-12-30", to: "2020-01-02" });
    expect(shiftYear("2028-02-29", 2027)).toBe("2027-02-28");
  });

  it("averages highs, lows and rain over every day of every year", () => {
    const stats = climateStats(parseArchive(archive), [2025]);
    expect(stats).toEqual({ avgHighC: 17.5, avgLowC: 10.2, rainyDayShare: 0.5, avgRainMm: 5.1, years: [2025] });
  });

  it("skips missing values", () => {
    const stats = climateStats(
      [{ dates: ["2025-03-16", "2025-03-17"], highC: [20, null], lowC: [10, null], rainMm: [0, null] }],
      [2025],
    );
    expect(stats.avgHighC).toBe(20);
    expect(stats.rainyDayShare).toBe(0);
  });

  it("refuses to invent numbers when there is no data", () => {
    expect(() => climateStats([{ dates: [], highC: [], lowC: [], rainMm: [] }], [2025])).toThrow(/No historical weather data/);
  });
});
