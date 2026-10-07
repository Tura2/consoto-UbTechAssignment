// Checks a drafted itinerary against the venues we found and the team's needs (policy rules 4 and 5).
import type { DietNeed, ItineraryCheck, ItineraryPlan, Place } from "../../../shared/domain";
import { addDays } from "./dates";
import { DIET_LABELS } from "./places";

export function checkItinerary(
  plan: ItineraryPlan,
  trip: { start: string; days: number },
  places: Place[],
  needs: DietNeed[],
): ItineraryCheck {
  const byId = new Map(places.map((place) => [place.id, place]));
  const problems: string[] = [];
  const uncoveredMeals: string[] = [];
  const mealsCoveredByCatering: string[] = [];
  const inaccessible = new Set<string>();
  const toConfirm = new Set<string>();

  if (plan.days.length !== trip.days) problems.push(`The plan has ${plan.days.length} days; the trip has ${trip.days}.`);

  plan.days.forEach((day, index) => {
    const expected = addDays(trip.start, index);
    if (day.date !== expected) problems.push(`Day ${index + 1} should be ${expected}, not ${day.date}.`);
    if (!day.items.some((item) => item.kind === "meal")) problems.push(`Day ${index + 1} has no meal, so the team's food needs are not covered.`);
    for (const item of day.items) {
      const label = `Day ${index + 1} ${item.slot}`;
      const venues: Place[] = [];
      for (const id of item.venueIds) {
        const place = byId.get(id);
        if (!place) {
          problems.push(`${label}: unknown venue id "${id}". Use only ids from the venues list.`);
          continue;
        }
        venues.push(place);
        if (place.wheelchair === "no") inaccessible.add(place.name);
        else if (place.wheelchair !== "yes") toConfirm.add(place.name);
      }
      if (item.kind === "activity" && item.venueIds.length === 0) toConfirm.add(item.note || label);
      if (item.kind !== "meal") continue;
      const fromVenues = new Set(venues.flatMap((venue) => venue.diets));
      const missing = needs.filter((need) => !fromVenues.has(need) && !item.catering.includes(need));
      const byCatering = needs.filter((need) => !fromVenues.has(need) && item.catering.includes(need));
      if (missing.length > 0) {
        const text = `${label}: no option for ${missing.map((need) => DIET_LABELS[need]).join(", ")}`;
        uncoveredMeals.push(text);
        problems.push(`${text}. Add a venue tagged for it or add catering.`);
      }
      if (byCatering.length > 0) {
        mealsCoveredByCatering.push(`${label}: ${byCatering.map((need) => DIET_LABELS[need]).join(", ")} catering`);
      }
    }
  });

  for (const name of inaccessible) problems.push(`${name} is tagged as not wheelchair accessible. Replace it.`);
  return {
    accepted: problems.length === 0,
    problems,
    notes: [...toConfirm].map((name) => `Confirm step-free access at ${name}.`),
    uncoveredMeals,
    mealsCoveredByCatering,
    inaccessible: [...inaccessible],
    accessToConfirm: [...toConfirm],
  };
}
