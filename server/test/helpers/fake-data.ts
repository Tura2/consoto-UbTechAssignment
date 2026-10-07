import type { HolidayItem, Source } from "../../../shared/domain";
import type { DataSources } from "../../src/clients/data-sources";
import overpass from "../fixtures/overpass-lisbon.json";

export const ISRAEL_MARCH_2027: HolidayItem[] = [
  { date: "2027-03-22", name: "Erev Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-23", name: "Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-24", name: "Shushan Purim", side: "israel", country: "Israel", source: "Hebcal" },
];

export const PORTUGAL_2027: HolidayItem[] = [
  { date: "2027-03-26", name: "Good Friday", side: "destination", country: "Portugal", source: "Nager.Date" },
  { date: "2027-03-28", name: "Easter Sunday", side: "destination", country: "Portugal", source: "Nager.Date" },
];

export const CZECHIA_2027: HolidayItem[] = [
  { date: "2027-03-26", name: "Good Friday", side: "destination", country: "Czechia", source: "Nager.Date" },
  { date: "2027-03-29", name: "Easter Monday", side: "destination", country: "Czechia", source: "Nager.Date" },
];

const POINTS: Record<string, { lat: number; lon: number }> = {
  Lisbon: { lat: 38.72509, lon: -9.1498 },
  Barcelona: { lat: 41.38879, lon: 2.15899 },
  Athens: { lat: 37.98376, lon: 23.72784 },
  Prague: { lat: 50.08804, lon: 14.42076 },
  Budapest: { lat: 47.49835, lon: 19.04045 },
};

export function fakeSource(name: string): Source {
  return { name, url: `https://example.test/${encodeURIComponent(name)}`, fetchedAt: "2026-10-06T08:00:00.000Z", cached: false };
}

// Canned answers for every data source. Override any method to simulate an outage.
export function fakeData(overrides: Partial<DataSources> = {}): DataSources {
  return {
    ecbRate: async () => ({ rate: { value: 3.431, date: "2026-10-05" }, source: fakeSource("Frankfurter (ECB rate)") }),
    israelHolidays: async (from, to) => ({
      items: ISRAEL_MARCH_2027.filter((holiday) => holiday.date >= from && holiday.date <= to),
      source: fakeSource("Hebcal (Israeli holidays)"),
    }),
    countryHolidays: async (country) => ({
      items: country.code === "PT" ? PORTUGAL_2027 : country.code === "CZ" ? CZECHIA_2027 : [],
      source: fakeSource(`Nager.Date (${country.name} public holidays)`),
    }),
    geocode: async (city) => {
      const point = POINTS[city];
      if (!point) throw new Error(`Open-Meteo geocoding found no "${city}"`);
      return { ...point, source: fakeSource("Open-Meteo (geocoding)") };
    },
    forecast: async (_point, from) => ({
      days: [{ date: from, highC: 20, lowC: 12, rainChancePct: 10 }],
      source: fakeSource("Open-Meteo (forecast)"),
    }),
    archive: async (points, from) => ({
      series: points.map(() => ({ dates: [from], highC: [18], lowC: [10], rainMm: [2] })),
      source: fakeSource("Open-Meteo (historical weather)"),
    }),
    overpass: async () => ({ elements: overpass.elements, source: fakeSource("OpenStreetMap (Overpass)") }),
    ...overrides,
  };
}
