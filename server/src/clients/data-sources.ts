// Every external data source the tools use, behind one interface so tests can swap in fakes.
import type { ForecastDay, HolidayItem, Rate, Source } from "../../../shared/domain";
import type { DailySeries } from "../domain/climate";
import { fetchEcbRate } from "./frankfurter";
import { fetchIsraelHolidays } from "./hebcal";
import type { Http } from "./http";
import { fetchCountryHolidays, type CountryRef } from "./nager";
import { fetchArchive, fetchForecast, geocodeCity, type Point } from "./open-meteo";
import { fetchOverpass } from "./overpass";

export type { CountryRef, Point };

export type DataSources = {
  ecbRate(signal: AbortSignal): Promise<{ rate: Rate; source: Source }>;
  israelHolidays(from: string, to: string, signal: AbortSignal): Promise<{ items: HolidayItem[]; source: Source }>;
  countryHolidays(country: CountryRef, year: number, signal: AbortSignal): Promise<{ items: HolidayItem[]; source: Source }>;
  geocode(city: string, countryCode: string | null, signal: AbortSignal): Promise<Point & { source: Source }>;
  forecast(point: Point, from: string, to: string, signal: AbortSignal): Promise<{ days: ForecastDay[]; source: Source }>;
  archive(points: Point[], from: string, to: string, signal: AbortSignal): Promise<{ series: DailySeries[]; source: Source }>;
  overpass(query: string, signal: AbortSignal): Promise<{ elements: unknown[]; source: Source }>;
};

export function createDataSources(http: Http): DataSources {
  return {
    ecbRate: (signal) => fetchEcbRate(http, signal),
    israelHolidays: (from, to, signal) => fetchIsraelHolidays(http, from, to, signal),
    countryHolidays: (country, year, signal) => fetchCountryHolidays(http, country, year, signal),
    geocode: (city, countryCode, signal) => geocodeCity(http, city, countryCode, signal),
    forecast: (point, from, to, signal) => fetchForecast(http, point, from, to, signal),
    archive: (points, from, to, signal) => fetchArchive(http, points, from, to, signal),
    overpass: (query, signal) => fetchOverpass(http, query, signal),
  };
}
