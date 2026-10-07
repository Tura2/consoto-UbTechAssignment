// Open-Meteo: geocoding, the 16-day forecast, and the historical archive. No key needed.
import { z } from "zod";
import type { ForecastDay, Source } from "../../../shared/domain";
import type { DailySeries } from "../domain/climate";
import type { Http } from "./http";

export type Point = { lat: number; lon: number };

const DAY = 86_400_000;
const HOUR = 3_600_000;

const GeocodeBody = z.object({
  results: z
    .array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number(), country_code: z.string() }))
    .optional(),
});

export function parseGeocode(body: unknown, countryCode: string | null): Point | null {
  const results = GeocodeBody.parse(body).results ?? [];
  const match = countryCode
    ? results.find((result) => result.country_code.toUpperCase() === countryCode.toUpperCase())
    : results[0];
  return match ? { lat: match.latitude, lon: match.longitude } : null;
}

export async function geocodeCity(
  http: Http,
  city: string,
  countryCode: string | null,
  signal?: AbortSignal,
): Promise<Point & { source: Source }> {
  const country = countryCode ? `&countryCode=${countryCode}` : "";
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=5&language=en&format=json${country}`;
  const result = await http.getJson({ name: "Open-Meteo (geocoding)", url, ttlMs: 365 * DAY, timeoutMs: 8_000, signal });
  const point = parseGeocode(result.body, countryCode);
  if (!point) throw new Error(`Open-Meteo geocoding found no "${city}"${countryCode ? ` in ${countryCode}` : ""}`);
  return { ...point, source: result.source };
}

const ForecastBody = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_probability_max: z.array(z.number().nullable()).optional(),
  }),
});

export function parseForecast(body: unknown): ForecastDay[] {
  const daily = ForecastBody.parse(body).daily;
  return daily.time.flatMap((date, i) => {
    const high = daily.temperature_2m_max[i];
    const low = daily.temperature_2m_min[i];
    if (high === null || high === undefined || low === null || low === undefined) return [];
    return [{ date, highC: high, lowC: low, rainChancePct: daily.precipitation_probability_max?.[i] ?? null }];
  });
}

export async function fetchForecast(
  http: Http,
  point: Point,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ days: ForecastDay[]; source: Source }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${point.lat}&longitude=${point.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto` +
    `&start_date=${from}&end_date=${to}`;
  const result = await http.getJson({ name: "Open-Meteo (forecast)", url, ttlMs: HOUR, timeoutMs: 8_000, signal });
  return { days: parseForecast(result.body), source: result.source };
}

const ArchiveLocation = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

// One location returns an object; several return an array in the same order as the request.
export function parseArchive(body: unknown): DailySeries[] {
  const locations = Array.isArray(body) ? body : [body];
  return locations.map((location) => {
    const daily = ArchiveLocation.parse(location).daily;
    return {
      dates: daily.time,
      highC: daily.temperature_2m_max,
      lowC: daily.temperature_2m_min,
      rainMm: daily.precipitation_sum,
    };
  });
}

export async function fetchArchive(
  http: Http,
  points: Point[],
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ series: DailySeries[]; source: Source }> {
  const latitudes = points.map((point) => point.lat).join(",");
  const longitudes = points.map((point) => point.lon).join(",");
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${latitudes}&longitude=${longitudes}` +
    `&start_date=${from}&end_date=${to}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  // Past weather never changes, so the cache can keep it for a year.
  const result = await http.getJson({ name: "Open-Meteo (historical weather)", url, ttlMs: 365 * DAY, timeoutMs: 15_000, signal });
  return { series: parseArchive(result.body), source: result.source };
}
