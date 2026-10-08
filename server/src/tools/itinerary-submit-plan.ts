import { z } from "zod";
import type { ItineraryCheck, ItineraryPlan } from "../../../shared/domain";
import { getTeam, teamNeeds } from "../data/consoto-data";
import { checkItinerary } from "../domain/itinerary-check";
import { DIETS, allPlaces } from "../domain/places";
import { IsoDate, defineTool, fail, ok } from "./types";

export type ItineraryData = { plan: ItineraryPlan; check: ItineraryCheck; placeNames: Record<string, string> };

const MAX_SUBMISSIONS = 2;

const ItemSchema = z.object({
  slot: z.enum(["morning", "lunch", "afternoon", "dinner"]),
  kind: z.enum(["activity", "meal"]),
  venueIds: z.array(z.string()).default([]).describe('Venue ids from the venues list, for example ["node/6124516487"]'),
  catering: z.array(z.enum(DIETS)).default([]).describe("Diets covered by booked catering"),
  note: z.string().default("").describe("Short description, for example the activity"),
});

export const itinerarySubmitPlan = defineTool({
  name: "itinerary_submit_plan",
  description:
    "Submit a draft day-by-day itinerary for code to check. Use only venue ids from the venues list you were given. " +
    "Each day lists items with a slot (morning, lunch, afternoon, dinner) and a kind (activity or meal). " +
    "Every meal needs an option for every dietary need: choose venues tagged for them, or add catering for a need, " +
    'for example "catering": ["kosher"]. Returns accepted, or the problems to fix. You can submit at most twice.',
  input: z.object({
    days: z.array(z.object({ date: IsoDate, items: z.array(ItemSchema).min(1) })).min(1).max(14),
  }),
  async execute(plan, ctx) {
    ctx.scratch.submissions = (ctx.scratch.submissions ?? 0) + 1;
    if (ctx.scratch.submissions > MAX_SUBMISSIONS) {
      return fail("submission_limit", "The plan was already submitted twice.", "Stop submitting. Summarize the remaining problems for the user.");
    }
    if (!ctx.findings.venues) {
      return fail("no_venues", "There is no venue list for this city yet.", "Tell the user the itinerary needs the venue search first.");
    }
    if (!ctx.trip.start) {
      return fail("no_dates", "The trip has no start date yet.", "Tell the user to pick dates first.");
    }
    const team = ctx.trip.team ? getTeam(ctx.trip.team) : null;
    const places = allPlaces(ctx.findings.venues);
    const check = checkItinerary(plan, { start: ctx.trip.start.date, days: ctx.trip.days }, places, team ? teamNeeds(team).diets : []);
    const placeNames = Object.fromEntries(places.map((place) => [place.id, place.name]));
    const data: ItineraryData = { plan, check, placeNames };
    return ok(itinerarySummary(data), data);
  },
});

function itinerarySummary({ plan, check }: ItineraryData): string {
  if (!check.accepted) return `Plan rejected: ${check.problems.length} problems to fix.`;
  const parts = [`${plan.days.length} days`];
  const access = check.accessToConfirm.length;
  const catering = check.mealsCoveredByCatering.length;
  if (access > 0) parts.push(`${access} ${access === 1 ? "place needs" : "places need"} an access check`);
  if (catering > 0) parts.push(`${catering} ${catering === 1 ? "meal needs" : "meals need"} catering`);
  return `Plan accepted: ${parts.join(", ")}.`;
}
