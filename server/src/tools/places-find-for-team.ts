import { z } from "zod";
import type { Place, VenuesResult } from "../../../shared/domain";
import { getDestination, getTeam, listTeams, teamNeeds } from "../data/consoto-data";
import { DIET_LABELS, buildPlacesQuery, summarizeVenues, toPlace } from "../domain/places";
import { defineTool, fail, ok } from "./types";

export const RADIUS_M = 3000;

export const placesFindForTeam = defineTool({
  name: "places_find_for_team",
  description:
    "Find restaurants and cafes that fit the team's dietary needs, and wheelchair-accessible sights, within 3 km of the city center, " +
    "from OpenStreetMap. The needs come from the team's data. A missing tag means unknown, not yes or no. " +
    'Example input: {"city": "Lisbon", "team": "platform"}.',
  input: z.object({
    city: z.string().min(1).describe('City name, for example "Lisbon"'),
    team: z.string().min(1).describe('Team id, for example "platform"'),
  }),
  async execute({ city, team }, ctx) {
    const found = getTeam(team);
    if (!found) {
      return fail("unknown_team", `No team data for "${team}".`, `Known teams: ${listTeams().join(", ")}. Tell the user there is no data for this team.`);
    }
    const destination = getDestination(city);
    const name = destination?.city ?? city;
    const point = await ctx.data.geocode(name, destination?.countryCode ?? null, ctx.signal);
    const needs = teamNeeds(found).diets;
    const { elements, source } = await ctx.data.overpass(buildPlacesQuery(point, RADIUS_M, needs), ctx.signal);
    const places = elements.map(toPlace).filter((place): place is Place => place !== null);
    const result = summarizeVenues(name, RADIUS_M, needs, places);
    return ok(venuesSummary(result), result, [point.source, source], result.gaps);
  },
});

function venuesSummary(result: VenuesResult): string {
  const perNeed = result.needs.map((need) => `${result.counts.byNeed[need] ?? 0} ${DIET_LABELS[need]}`).join(", ");
  return `${result.city}: ${result.counts.food} food places match a team diet (${perNeed}); ${result.counts.sights} wheelchair-accessible sights.`;
}
