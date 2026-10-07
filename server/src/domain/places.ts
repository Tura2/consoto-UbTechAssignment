// Reading OpenStreetMap places for the team's needs. A missing tag means "unknown", never "yes".
import type { DietNeed, Place, VenuesResult, Wheelchair } from "../../../shared/domain";

const DIET_TAGS: Record<DietNeed, string> = {
  vegan: "diet:vegan",
  kosher: "diet:kosher",
  gluten_free: "diet:gluten_free",
};

export const DIET_LABELS: Record<DietNeed, string> = { vegan: "vegan", kosher: "kosher", gluten_free: "gluten-free" };

const DIET_ORDER: DietNeed[] = ["vegan", "kosher", "gluten_free"];
const WHEELCHAIR_RANK: Record<Wheelchair, number> = { yes: 0, limited: 1, unknown: 2, no: 3 };

export function buildPlacesQuery(point: { lat: number; lon: number }, radiusM: number, needs: DietNeed[]): string {
  const around = `(around:${radiusM},${point.lat},${point.lon})`;
  const food =
    needs.length > 0
      ? [
          `nwr["amenity"~"^(restaurant|cafe)$"]${around}->.food;`,
          `(${needs.map((need) => `nwr.food["${DIET_TAGS[need]}"~"^(yes|only)$"];`).join("")})->.diet;`,
          ".diet out tags center 150;",
        ].join("\n")
      : `nwr["amenity"~"^(restaurant|cafe)$"]["wheelchair"="yes"]${around};\nout tags center 60;`;
  const sights = `nwr["tourism"~"^(museum|attraction|gallery|viewpoint)$"]["wheelchair"="yes"]${around};\nout tags center 30;`;
  return `[out:json][timeout:25];\n${food}\n${sights}`;
}

export function readWheelchair(value: string | undefined): Wheelchair {
  return value === "yes" || value === "limited" || value === "no" ? value : "unknown";
}

type RawElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function toPlace(raw: unknown): Place | null {
  const element = raw as RawElement;
  const tags = element.tags ?? {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const kind = tags.amenity === "restaurant" || tags.amenity === "cafe" ? "food" : tags.tourism ? "sight" : null;
  if (!tags.name || lat === undefined || lon === undefined || !kind) return null;
  return {
    id: `${element.type}/${element.id}`,
    name: tags.name,
    kind,
    diets: DIET_ORDER.filter((need) => ["yes", "only"].includes(tags[DIET_TAGS[need]] ?? "")),
    wheelchair: readWheelchair(tags.wheelchair),
    lat,
    lon,
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    cuisine: tags.cuisine ?? null,
  };
}

function rankFood(places: Place[], needs: DietNeed[]): Place[] {
  const covered = (place: Place) => place.diets.filter((diet) => needs.includes(diet)).length;
  return [...places].sort(
    (a, b) =>
      covered(b) - covered(a) ||
      WHEELCHAIR_RANK[a.wheelchair] - WHEELCHAIR_RANK[b.wheelchair] ||
      a.name.localeCompare(b.name),
  );
}

function uniqueBy(places: Place[], key: (place: Place) => string): Place[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const value = key(place);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function summarizeVenues(city: string, radiusM: number, needs: DietNeed[], places: Place[]): VenuesResult {
  const food = rankFood(uniqueBy(places.filter((p) => p.kind === "food"), (p) => p.id), needs);
  const sights = uniqueBy(places.filter((p) => p.kind === "sight"), (p) => p.name.toLowerCase());
  const km = radiusM / 1000;
  const byNeed: Partial<Record<DietNeed, Place[]>> = {};
  const countsByNeed: Partial<Record<DietNeed, number>> = {};
  const gaps: string[] = [];
  for (const need of needs) {
    const matches = food.filter((place) => place.diets.includes(need));
    byNeed[need] = matches.slice(0, 5);
    countsByNeed[need] = matches.length;
    if (matches.length === 0) gaps.push(`No places tagged ${DIET_LABELS[need]} within ${km} km in OpenStreetMap.`);
  }
  if (needs.length > 1 && !food.some((place) => needs.every((need) => place.diets.includes(need)))) {
    gaps.push(`No single place within ${km} km is tagged for all of: ${needs.map((need) => DIET_LABELS[need]).join(", ")}.`);
  }
  const unknown = food.filter((place) => place.wheelchair === "unknown").length;
  if (food.length > 0 && unknown / food.length > 0.5) {
    gaps.push(`Wheelchair access is not recorded for ${unknown} of ${food.length} food places.`);
  }
  if (sights.length === 0) gaps.push(`No sights tagged wheelchair=yes within ${km} km in OpenStreetMap.`);
  return {
    city,
    radiusM,
    needs,
    byNeed,
    bestFood: food.slice(0, 5),
    sights: sights.slice(0, 8),
    counts: { food: food.length, sights: sights.length, byNeed: countsByNeed, wheelchairUnknown: unknown },
    gaps,
  };
}

// Every place the result shows (the itinerary may only use these).
export function allPlaces(result: VenuesResult): Place[] {
  const listed = [...result.bestFood, ...Object.values(result.byNeed).flatMap((list) => list ?? []), ...result.sights];
  return uniqueBy(listed, (place) => place.id);
}
