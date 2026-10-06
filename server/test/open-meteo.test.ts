import { describe, expect, it } from "vitest";
import { fetchArchive, fetchForecast, geocodeCity, parseArchive, parseForecast, parseGeocode } from "../src/clients/open-meteo";
import archive from "./fixtures/archive-lisbon-2025.json";
import forecast from "./fixtures/forecast-lisbon.json";
import geocode from "./fixtures/geocode-lisbon.json";
import { fakeHttp } from "./helpers/fake-http";

describe("Open-Meteo", () => {
  it("picks the geocoding result in the right country", () => {
    expect(parseGeocode(geocode, "PT")).toEqual({ lat: 38.72509, lon: -9.1498 });
    expect(parseGeocode(geocode, "US")).toEqual({ lat: 40.772, lon: -80.76813 });
    expect(parseGeocode(geocode, "GR")).toBeNull();
    expect(parseGeocode(geocode, null)).toEqual({ lat: 38.72509, lon: -9.1498 });
  });

  it("throws a clear error when a city cannot be found", async () => {
    const { http } = fakeHttp({ results: [] });
    await expect(geocodeCity(http, "Atlantis", "PT")).rejects.toThrow(/found no "Atlantis"/);
  });

  it("filters geocoding by country in the request", async () => {
    const { http, calls } = fakeHttp(geocode);
    const point = await geocodeCity(http, "Lisbon", "PT");
    expect(calls[0].url).toContain("name=Lisbon");
    expect(calls[0].url).toContain("countryCode=PT");
    expect(point).toMatchObject({ lat: 38.72509, lon: -9.1498 });
  });

  it("parses a daily forecast", () => {
    expect(parseForecast(forecast)).toEqual([
      { date: "2026-10-07", highC: 24, lowC: 17.2, rainChancePct: 0 },
      { date: "2026-10-08", highC: 27.5, lowC: 16.2, rainChancePct: 0 },
      { date: "2026-10-09", highC: 26.9, lowC: 17.5, rainChancePct: 0 },
    ]);
  });

  it("asks the forecast for exact dates", async () => {
    const { http, calls } = fakeHttp(forecast);
    await fetchForecast(http, { lat: 38.72509, lon: -9.1498 }, "2026-10-07", "2026-10-09");
    expect(calls[0].url).toContain("start_date=2026-10-07&end_date=2026-10-09");
  });

  it("parses one archive location or several", () => {
    expect(parseArchive(archive)).toHaveLength(1);
    expect(parseArchive(archive)[0].dates).toHaveLength(16);
    expect(parseArchive([archive, archive])).toHaveLength(2);
  });

  it("puts all cities in one archive request", async () => {
    const { http, calls } = fakeHttp([archive, archive]);
    const result = await fetchArchive(
      http,
      [{ lat: 38.72509, lon: -9.1498 }, { lat: 50.08804, lon: 14.42076 }],
      "2025-03-16",
      "2025-03-31",
    );
    expect(calls[0].url).toContain("latitude=38.72509,50.08804");
    expect(calls[0].url).toContain("longitude=-9.1498,14.42076");
    expect(result.series).toHaveLength(2);
  });
});
