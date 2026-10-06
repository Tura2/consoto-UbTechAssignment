import { describe, expect, it } from "vitest";
import type { ItineraryPlan } from "../../shared/domain";
import { checkItinerary } from "../src/domain/itinerary-check";
import { allPlaces } from "../src/domain/places";
import { GOOD_PLAN, LISBON_NEEDS, lisbonVenues } from "./helpers/lisbon";

const NEEDS = LISBON_NEEDS;
const places = allPlaces(lisbonVenues());
const TRIP = { start: "2027-03-16", days: 3 };

describe("checkItinerary", () => {
  it("accepts a plan where every meal covers every diet, noting catering and access to confirm", () => {
    const check = checkItinerary(GOOD_PLAN, TRIP, places, NEEDS);
    expect(check.accepted).toBe(true);
    expect(check.problems).toEqual([]);
    expect(check.uncoveredMeals).toEqual([]);
    expect(check.mealsCoveredByCatering).toEqual([
      "Day 1 lunch: kosher catering",
      "Day 2 lunch: kosher catering",
      "Day 3 lunch: kosher catering",
    ]);
    expect(check.accessToConfirm).toEqual(["Olha que Dois"]);
    expect(check.notes).toEqual(["Confirm step-free access at Olha que Dois."]);
  });

  it("rejects unknown venues, uncovered meals, inaccessible places and wrong dates", () => {
    const bad: ItineraryPlan = {
      days: [
        { date: "2027-03-17", items: [{ slot: "dinner", kind: "meal", venueIds: ["node/4256789936", "node/1"], catering: [], note: "" }] },
        { date: "2027-03-18", items: [] },
      ],
    };
    const check = checkItinerary(bad, TRIP, places, NEEDS);
    expect(check.accepted).toBe(false);
    expect(check.problems).toEqual([
      "The plan has 2 days; the trip has 3.",
      "Day 1 should be 2027-03-16, not 2027-03-17.",
      'Day 1 dinner: unknown venue id "node/1". Use only ids from the venues list.',
      "Day 1 dinner: no option for kosher. Add a venue tagged for it or add catering.",
      "Day 2 should be 2027-03-17, not 2027-03-18.",
      "Ao 26 is tagged as not wheelchair accessible. Replace it.",
    ]);
    expect(check.uncoveredMeals).toEqual(["Day 1 dinner: no option for kosher"]);
    expect(check.inaccessible).toEqual(["Ao 26"]);
  });
});
