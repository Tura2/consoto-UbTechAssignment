import { describe, expect, it } from "vitest";
import { calendarFindCleanWindows, type CalendarData } from "../src/tools/calendar-find-clean-windows";
import { runTool } from "../src/tools/types";
import { weatherGetOutlook, type WeatherData } from "../src/tools/weather-get-outlook";
import { makeCtx } from "./helpers/ctx";
import { fakeData } from "./helpers/fake-data";

const MARCH = { from: "2027-03-16", to: "2027-03-31" };

describe("calendar_find_clean_windows", () => {
  it("finds Lisbon's clean windows from both holiday sources", async () => {
    const result = await runTool(calendarFindCleanWindows, { cities: ["Lisbon"], ...MARCH, days: 3 }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe(
      "Lisbon: 5 of 14 3-day windows are clean (Israel: Erev Purim, Purim, Shushan Purim; Portugal: Good Friday, Easter Sunday).",
    );
    const data = result.data as CalendarData;
    expect(data.cities[0].windows.filter((w) => w.clean).map((w) => w.start)).toEqual([
      "2027-03-16",
      "2027-03-17",
      "2027-03-18",
      "2027-03-19",
      "2027-03-29",
    ]);
    expect(result.sources.map((s) => s.name)).toEqual(["Hebcal (Israeli holidays)", "Nager.Date (Portugal public holidays)"]);
  });

  it("summarizes several cities at once", async () => {
    const result = await runTool(calendarFindCleanWindows, { cities: ["Lisbon", "Prague"], ...MARCH, days: 3 }, makeCtx());
    expect(result).toMatchObject({ ok: true, summary: "Clean 3-day windows: Lisbon 5 of 14, Prague 4 of 14." });
  });

  it("reports a city without country data as a gap", async () => {
    const result = await runTool(calendarFindCleanWindows, { cities: ["Rome"], ...MARCH, days: 3 }, makeCtx());
    expect(result).toMatchObject({ ok: true, gaps: ["No country data for Rome, so its public holidays are unknown."] });
  });

  it("rejects a range that ends before it starts", async () => {
    const result = await runTool(calendarFindCleanWindows, { cities: ["Lisbon"], from: "2027-03-31", to: "2027-03-16", days: 3 }, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("weather_get_outlook", () => {
  it("uses a 10-year climate average when March is past the forecast", async () => {
    let archiveCalls = 0;
    const base = fakeData();
    const ctx = makeCtx({ data: { ...base, archive: (...args) => { archiveCalls++; return base.archive(...args); } } });
    const result = await runTool(weatherGetOutlook, { cities: ["Lisbon"], ...MARCH }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(archiveCalls).toBe(10);
    expect(result.summary).toBe(
      "Lisbon: no forecast yet (161 days away). Climate average 2017-2026: highs 18 C, lows 10 C, rain on 100% of days.",
    );
    const outlook = (result.data as WeatherData).cities[0].outlook;
    expect(outlook).toMatchObject({ kind: "climate_average", reason: "Forecasts reach 16 days ahead; 2027-03-16 is 161 days away." });
  });

  it("uses the forecast when the dates are close", async () => {
    const result = await runTool(weatherGetOutlook, { cities: ["Lisbon"], from: "2026-10-08", to: "2026-10-10" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as WeatherData).cities[0].outlook.kind).toBe("forecast");
  });

  it("puts all cities in each yearly archive request", async () => {
    const pointsPerCall: number[] = [];
    const base = fakeData();
    const ctx = makeCtx({ data: { ...base, archive: (points, ...rest) => { pointsPerCall.push(points.length); return base.archive(points, ...rest); } } });
    await runTool(weatherGetOutlook, { cities: ["Lisbon", "Prague", "Athens"], ...MARCH }, ctx);
    expect(pointsPerCall).toEqual(Array(10).fill(3));
  });

  it("reports a city it cannot locate as a gap and fails if none can be located", async () => {
    const mixed = await runTool(weatherGetOutlook, { cities: ["Lisbon", "Rome"], ...MARCH }, makeCtx());
    expect(mixed).toMatchObject({ ok: true, gaps: [expect.stringContaining("Could not locate Rome")] });
    const none = await runTool(weatherGetOutlook, { cities: ["Rome"], ...MARCH }, makeCtx());
    expect(none).toMatchObject({ ok: false, error: { code: "no_locations" } });
  });
});
