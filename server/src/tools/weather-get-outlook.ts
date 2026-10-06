import { z } from "zod";
import type { Source, WeatherOutlook } from "../../../shared/domain";
import type { Point } from "../clients/data-sources";
import { getDestination } from "../data/consoto-data";
import { climateStats, climateYears, windowInYear } from "../domain/climate";
import { daysBetween, forecastAvailable } from "../domain/dates";
import { IsoDate, defineTool, fail, ok } from "./types";

export type WeatherData = { from: string; to: string; cities: { city: string; outlook: WeatherOutlook }[] };

export const weatherGetOutlook = defineTool({
  name: "weather_get_outlook",
  description:
    "Weather for one or more cities between two dates. Returns a daily forecast when the whole range is within the 16-day forecast window; " +
    "otherwise returns the average of the same dates over the last 10 years, labeled as a climate average, not a forecast. " +
    'Example input: {"cities": ["Lisbon"], "from": "2027-03-16", "to": "2027-03-31"}.',
  input: z
    .object({
      cities: z.array(z.string().min(1)).min(1).max(5).describe('City names, for example ["Lisbon"]'),
      from: IsoDate.describe("First day, YYYY-MM-DD"),
      to: IsoDate.describe("Last day, YYYY-MM-DD"),
    })
    .refine((input) => input.from <= input.to, { message: "from must be on or before to" }),
  async execute({ cities, from, to }, ctx) {
    const sources: Source[] = [];
    const gaps: string[] = [];
    // Promise.all keeps the order of the request, so results line up with the cities asked for.
    const lookups = await Promise.all(
      cities.map(async (name): Promise<{ city: string; point: Point } | null> => {
        const destination = getDestination(name);
        const city = destination?.city ?? name;
        try {
          const point = await ctx.data.geocode(city, destination?.countryCode ?? null, ctx.signal);
          sources.push(point.source);
          return { city, point: { lat: point.lat, lon: point.lon } };
        } catch (error) {
          if (ctx.signal.aborted) throw error;
          gaps.push(`Could not locate ${name}: ${(error as Error).message}.`);
          return null;
        }
      }),
    );
    const located = lookups.filter((lookup): lookup is { city: string; point: Point } => lookup !== null);
    if (located.length === 0) {
      return fail("no_locations", "Could not locate any of the cities.", "Tell the user the weather is unavailable for these cities.");
    }

    let results: WeatherData["cities"];
    if (forecastAvailable(to, ctx.today)) {
      results = await Promise.all(
        located.map(async ({ city, point }) => {
          const forecast = await ctx.data.forecast(point, from, to, ctx.signal);
          sources.push(forecast.source);
          return { city, outlook: { kind: "forecast" as const, from, to, days: forecast.days } };
        }),
      );
    } else {
      const years = climateYears(from, to, ctx.today);
      const perYear = await Promise.all(
        years.map((year) => {
          const window = windowInYear(from, to, year);
          return ctx.data.archive(located.map((l) => l.point), window.from, window.to, ctx.signal);
        }),
      );
      sources.push(...perYear.map((result) => result.source));
      const reason = `Forecasts reach 16 days ahead; ${from} is ${daysBetween(ctx.today, from)} days away.`;
      results = located.map(({ city }, index) => ({
        city,
        outlook: {
          kind: "climate_average" as const,
          from,
          to,
          stats: climateStats(perYear.map((result) => result.series[index]), years),
          reason,
        },
      }));
    }
    const data: WeatherData = { from, to, cities: results };
    return ok(weatherSummary(data, ctx.today), data, sources, gaps);
  },
});

function weatherSummary(data: WeatherData, today: string): string {
  const [first] = data.cities;
  if (data.cities.length === 1 && first.outlook.kind === "climate_average") {
    const { stats } = first.outlook;
    const span = `${stats.years[0]}-${stats.years[stats.years.length - 1]}`;
    return (
      `${first.city}: no forecast yet (${daysBetween(today, data.from)} days away). ` +
      `Climate average ${span}: highs ${stats.avgHighC} C, lows ${stats.avgLowC} C, rain on ${Math.round(stats.rainyDayShare * 100)}% of days.`
    );
  }
  if (data.cities.length === 1 && first.outlook.kind === "forecast") {
    const highs = first.outlook.days.map((day) => day.highC);
    return `${first.city}: forecast for ${highs.length} days, highs ${Math.min(...highs)} to ${Math.max(...highs)} C.`;
  }
  const kind = first.outlook.kind === "forecast" ? "forecast" : "climate average of the last 10 years (no forecast yet)";
  return `${data.cities.length} cities: ${kind}.`;
}
