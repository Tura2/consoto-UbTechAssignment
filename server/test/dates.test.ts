import { describe, expect, it } from "vitest";
import type { HolidayItem } from "../../shared/domain";
import {
  addDays,
  buildWindows,
  daysBetween,
  describeWindow,
  forecastAvailable,
  nearestCleanWindows,
  resolveSearchPeriod,
  resolveStartDay,
  weekday,
} from "../src/domain/dates";

const HOLIDAYS: HolidayItem[] = [
  { date: "2027-03-22", name: "Erev Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-23", name: "Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-24", name: "Shushan Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-26", name: "Good Friday", side: "destination", country: "Portugal", source: "Nager.Date" },
  { date: "2027-03-28", name: "Easter Sunday", side: "destination", country: "Portugal", source: "Nager.Date" },
];

describe("date helpers", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2027-03-31", 1)).toBe("2027-04-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-06", "2027-03-16")).toBe(161);
    expect(weekday("2027-03-16")).toBe("Tue");
  });

  it("resolves 'second half of March' to the next March", () => {
    expect(resolveSearchPeriod({ month: 3, part: "second_half" }, "2026-10-06")).toEqual({
      from: "2027-03-16",
      to: "2027-03-31",
    });
  });

  it("keeps this year's period until it has passed", () => {
    expect(resolveSearchPeriod({ month: 10, part: "first_half" }, "2026-10-06")).toEqual({
      from: "2026-10-01",
      to: "2026-10-15",
    });
    expect(resolveSearchPeriod({ month: 10, part: "first_half" }, "2026-10-20")).toEqual({
      from: "2027-10-01",
      to: "2027-10-15",
    });
  });

  it("handles leap years for a whole February", () => {
    expect(resolveSearchPeriod({ month: 2, part: "whole" }, "2027-10-01")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("resolves a named start day inside the search window", () => {
    const window = { from: "2027-03-16", to: "2027-03-31" };
    expect(resolveStartDay({ month: 3, day: 29 }, window, "2026-10-06")).toBe("2027-03-29");
    expect(resolveStartDay({ month: 3, day: 29 }, null, "2026-10-06")).toBe("2027-03-29");
    expect(resolveStartDay({ month: 2, day: 30 }, null, "2026-10-06")).toBeNull();
  });

  it("finds the clean 3-day windows in the second half of March 2027", () => {
    const windows = buildWindows("2027-03-16", "2027-03-31", 3, HOLIDAYS);
    expect(windows).toHaveLength(14);
    expect(windows.filter((w) => w.clean).map((w) => w.start)).toEqual([
      "2027-03-16",
      "2027-03-17",
      "2027-03-18",
      "2027-03-19",
      "2027-03-29",
    ]);
  });

  it("labels Israeli weekend days without blocking them", () => {
    const window = describeWindow("2027-03-18", 3, HOLIDAYS);
    expect(window.clean).toBe(true);
    expect(window.weekdays).toEqual(["Thu", "Fri", "Sat"]);
    expect(window.israeliWeekendDays).toEqual(["2027-03-19", "2027-03-20"]);
  });

  it("lists clashes for a blocked window", () => {
    const window = describeWindow("2027-03-22", 3, HOLIDAYS);
    expect(window.clean).toBe(false);
    expect(window.clashes.map((h) => h.name)).toEqual(["Erev Purim", "Purim", "Shushan Purim"]);
  });

  it("orders clean windows by distance from a target date", () => {
    const windows = buildWindows("2027-03-16", "2027-03-31", 3, HOLIDAYS);
    expect(nearestCleanWindows(windows, "2027-03-22").map((w) => w.start)).toEqual([
      "2027-03-19",
      "2027-03-18",
      "2027-03-17",
    ]);
  });

  it("knows the 16-day forecast range", () => {
    expect(forecastAvailable("2026-10-21", "2026-10-06")).toBe(true);
    expect(forecastAvailable("2026-10-22", "2026-10-06")).toBe(false);
  });
});
