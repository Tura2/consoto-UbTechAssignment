// Public holidays by country from Nager.Date v4 (new domain; date.nager.at/api/v4 is a 404).
import { z } from "zod";
import type { HolidayItem, Source } from "../../../shared/domain";
import { WEEK_MS } from "../lib/time";
import type { Http } from "./http";

export type CountryRef = { code: string; name: string; subdivisionCode: string | null };

const NagerRows = z.array(
  z.object({
    date: z.string(),
    name: z.string(),
    nationalHoliday: z.boolean(),
    subdivisionCodes: z.array(z.string()).nullable(),
    holidayTypes: z.array(z.string()),
  }),
);

export function nagerUrl(countryCode: string, year: number): string {
  return `https://nagerholidays.com/api/v4/Holidays/${countryCode}/${year}`;
}

export function parseNagerHolidays(body: unknown, country: CountryRef): HolidayItem[] {
  return NagerRows.parse(body)
    .filter((holiday) => holiday.holidayTypes.includes("Public"))
    .filter(
      (holiday) =>
        holiday.nationalHoliday ||
        (country.subdivisionCode !== null && (holiday.subdivisionCodes ?? []).includes(country.subdivisionCode)),
    )
    .map((holiday) => ({
      date: holiday.date,
      name: holiday.name,
      side: "destination" as const,
      country: country.name,
      source: "Nager.Date",
    }));
}

export async function fetchCountryHolidays(
  http: Http,
  country: CountryRef,
  year: number,
  signal?: AbortSignal,
): Promise<{ items: HolidayItem[]; source: Source }> {
  const result = await http.getJson({
    name: `Nager.Date (${country.name} public holidays)`,
    url: nagerUrl(country.code, year),
    ttlMs: WEEK_MS,
    timeoutMs: 8_000,
    signal,
  });
  return { items: parseNagerHolidays(result.body, country), source: result.source };
}
