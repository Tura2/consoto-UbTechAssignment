import { z } from "zod";
import type { DateWindow, HolidayItem, Source } from "../../../shared/domain";
import { getDestination } from "../data/consoto-data";
import { buildWindows } from "../domain/dates";
import { dedupeSources, holidaysBetween } from "./helpers";
import { IsoDate, defineTool, ok } from "./types";

export type CalendarData = {
  from: string;
  to: string;
  days: number;
  cities: { city: string; holidays: HolidayItem[]; windows: DateWindow[] }[];
};

export const calendarFindCleanWindows = defineTool({
  name: "calendar_find_clean_windows",
  description:
    "Find holidays in Israel (Hebcal) and public holidays at the destination (Nager.Date) between two dates, " +
    "and list every window of the given length with its weekdays and clashes. A window is clean when no day is a holiday on either side. " +
    "Days on the Israeli weekend (Friday, Saturday) are labeled, not blocked. " +
    'Example input: {"cities": ["Lisbon"], "from": "2027-03-16", "to": "2027-03-31", "days": 3}.',
  input: z
    .object({
      cities: z.array(z.string().min(1)).min(1).max(5).describe('City names, for example ["Lisbon"]'),
      from: IsoDate.describe("First possible day, YYYY-MM-DD"),
      to: IsoDate.describe("Last possible day, YYYY-MM-DD"),
      days: z.number().int().min(1).max(14).describe("Trip length in days"),
    })
    .refine((input) => input.from <= input.to, { message: "from must be on or before to" }),
  async execute({ cities, from, to, days }, ctx) {
    const lookups = await Promise.all(
      cities.map(async (city) => ({ city, holidays: await holidaysBetween(city, from, to, ctx) })),
    );
    const results: CalendarData["cities"] = [];
    const sources: Source[] = [];
    const gaps: string[] = [];
    for (const { city, holidays } of lookups) {
      const destination = getDestination(city);
      if (!holidays || !destination) {
        gaps.push(`No country data for ${city}, so its public holidays are unknown.`);
        continue;
      }
      sources.push(...holidays.sources);
      results.push({ city: destination.city, holidays: holidays.items, windows: buildWindows(from, to, days, holidays.items) });
    }
    const data: CalendarData = { from, to, days, cities: results };
    return ok(calendarSummary(data), data, dedupeSources(sources), gaps);
  },
});

function holidayList(items: HolidayItem[]): string {
  if (items.length === 0) return "no holidays";
  const byCountry = new Map<string, string[]>();
  for (const holiday of items) byCountry.set(holiday.country, [...(byCountry.get(holiday.country) ?? []), holiday.name]);
  return [...byCountry].map(([country, names]) => `${country}: ${[...new Set(names)].join(", ")}`).join("; ");
}

function calendarSummary(data: CalendarData): string {
  const count = (windows: DateWindow[]) => `${windows.filter((w) => w.clean).length} of ${windows.length}`;
  if (data.cities.length === 0) return "No holiday data for these cities.";
  if (data.cities.length === 1) {
    const [only] = data.cities;
    return `${only.city}: ${count(only.windows)} ${data.days}-day windows are clean (${holidayList(only.holidays)}).`;
  }
  return `Clean ${data.days}-day windows: ${data.cities.map((c) => `${c.city} ${count(c.windows)}`).join(", ")}.`;
}
