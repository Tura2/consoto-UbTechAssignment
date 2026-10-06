// Lisbon test data built from the recorded Overpass fixture, shared by several test files.
import type { DietNeed, ItineraryPlan, Place, VenuesResult } from "../../../shared/domain";
import { summarizeVenues, toPlace } from "../../src/domain/places";
import overpass from "../fixtures/overpass-lisbon.json";

export const LISBON_NEEDS: DietNeed[] = ["vegan", "kosher", "gluten_free"];

export function lisbonVenues(): VenuesResult {
  const places = overpass.elements.map(toPlace).filter((place): place is Place => place !== null);
  return summarizeVenues("Lisbon", 3000, LISBON_NEEDS, places);
}

// A valid 3-day plan: kosher catering at lunch, Olha que Dois (access unknown) at dinner on day 1.
export const GOOD_PLAN: ItineraryPlan = {
  days: [
    {
      date: "2027-03-16",
      items: [
        { slot: "morning", kind: "activity", venueIds: ["node/4804718021"], catering: [], note: "Museum" },
        { slot: "lunch", kind: "meal", venueIds: ["node/10924175605"], catering: ["kosher"], note: "" },
        { slot: "afternoon", kind: "activity", venueIds: ["node/1801653047"], catering: [], note: "" },
        { slot: "dinner", kind: "meal", venueIds: ["node/6124516487", "node/1831989609"], catering: [], note: "" },
      ],
    },
    { date: "2027-03-17", items: [{ slot: "lunch", kind: "meal", venueIds: ["node/6124516487"], catering: ["kosher"], note: "" }] },
    { date: "2027-03-18", items: [{ slot: "lunch", kind: "meal", venueIds: ["node/10924175605"], catering: ["kosher"], note: "" }] },
  ],
};
