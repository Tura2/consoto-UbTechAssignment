import { describe, expect, it } from "vitest";
import type { Place } from "../../shared/domain";
import { OVERPASS_URL, checkOverpassRemark, fetchOverpass } from "../src/clients/overpass";
import { allPlaces, buildPlacesQuery, readWheelchair, summarizeVenues, toPlace } from "../src/domain/places";
import overpass from "./fixtures/overpass-lisbon.json";
import { fakeHttp } from "./helpers/fake-http";
import { LISBON_NEEDS as NEEDS } from "./helpers/lisbon";

const places = overpass.elements.map(toPlace).filter((place): place is Place => place !== null);

describe("places", () => {
  it("builds one query from the team's needs", () => {
    const query = buildPlacesQuery({ lat: 38.72509, lon: -9.1498 }, 3000, NEEDS);
    expect(query).toContain("[out:json][timeout:25]");
    expect(query).toContain("(around:3000,38.72509,-9.1498)");
    expect(query).toContain('nwr.food["diet:kosher"~"^(yes|only)$"]');
    expect(query).toContain(".diet out tags center 150;");
    expect(query).toContain('["wheelchair"="yes"]');
  });

  it("asks only for wheelchair-friendly restaurants when the team has no diets", () => {
    const query = buildPlacesQuery({ lat: 1, lon: 2 }, 3000, []);
    expect(query).not.toContain("diet:");
    expect(query).toContain('nwr["amenity"~"^(restaurant|cafe)$"]["wheelchair"="yes"]');
  });

  it("reads OSM elements into places and skips unnamed ones", () => {
    expect(places).toHaveLength(9);
    expect(places[1]).toEqual({
      id: "node/6124516487",
      name: "Organi Chiado",
      kind: "food",
      diets: ["vegan", "gluten_free"],
      wheelchair: "yes",
      osmUrl: "https://www.openstreetmap.org/node/6124516487",
    });
    expect(places[5].kind).toBe("sight");
  });

  it("treats a missing wheelchair tag as unknown", () => {
    expect(readWheelchair(undefined)).toBe("unknown");
    expect(readWheelchair("bad value")).toBe("unknown");
    expect(readWheelchair("limited")).toBe("limited");
  });

  it("ranks food by needs covered, then wheelchair access, then name", () => {
    const result = summarizeVenues("Lisbon", 3000, NEEDS, places);
    expect(result.bestFood.map((p) => p.name)).toEqual([
      "AMUN Café",
      "Organi Chiado",
      "Ao 26",
      "Olha que Dois",
      "Restaurante Greenpepper",
    ]);
    expect(result.byNeed.kosher?.map((p) => p.name)).toEqual(["Olha que Dois"]);
    expect(result.counts.byNeed).toEqual({ vegan: 4, kosher: 1, gluten_free: 3 });
    expect(result.counts.wheelchairUnknown).toBe(2);
  });

  it("deduplicates sights by name", () => {
    const result = summarizeVenues("Lisbon", 3000, NEEDS, places);
    expect(result.sights.map((p) => p.name)).toEqual([
      "Miradouro do Castelo de São Jorge",
      "Figueira-da-Austrália",
      "Museu do Dinheiro",
    ]);
  });

  it("reports the gaps honestly", () => {
    const result = summarizeVenues("Lisbon", 3000, NEEDS, places);
    expect(result.gaps).toEqual(["No single place within 3 km is tagged for all of: vegan, kosher, gluten-free."]);
    const noKosher = summarizeVenues("Lisbon", 3000, NEEDS, places.filter((p) => !p.diets.includes("kosher")));
    expect(noKosher.gaps[0]).toBe("No places tagged kosher within 3 km in OpenStreetMap.");
  });

  it("lists every place the result shows, once", () => {
    const result = summarizeVenues("Lisbon", 3000, NEEDS, places);
    const ids = allPlaces(result).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("node/1831989609");
    expect(ids).toContain("node/4804718021");
  });

  it("sends Overpass queries one at a time, without retries", async () => {
    const { http, calls } = fakeHttp(overpass);
    const result = await fetchOverpass(http, "[out:json];node(1);out;");
    expect(calls[0]).toMatchObject({ url: OVERPASS_URL, method: "POST", retries: 0, maxConcurrency: 1 });
    expect(calls[0].body).toBe(`data=${encodeURIComponent("[out:json];node(1);out;")}`);
    expect(result.elements).toHaveLength(10);
  });

  it("rejects an Overpass runtime-error remark", () => {
    expect(() =>
      checkOverpassRemark({
        elements: [],
        remark: 'runtime error: Query timed out in "query" at line 3 after 26 seconds.',
      })
    ).toThrow('runtime error: Query timed out in "query" at line 3 after 26 seconds.');
    expect(() => checkOverpassRemark(overpass)).not.toThrow();
  });

  it("passes a validate function in the Overpass spec", async () => {
    const { http, calls } = fakeHttp(overpass);
    await fetchOverpass(http, "[out:json];node(1);out;");
    expect(calls[0].validate).toBeInstanceOf(Function);
  });
});
