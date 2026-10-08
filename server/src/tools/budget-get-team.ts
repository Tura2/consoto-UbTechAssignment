import { z } from "zod";
import { getTeam, teamNeeds } from "../data/consoto-data";
import { describeNeeds, internalSource, unknownTeam } from "./helpers";
import { defineTool, ok } from "./types";

export const budgetGetTeam = defineTool({
  name: "budget_get_team",
  description:
    'Get a Consoto team from internal HR data: members, size, dietary needs and accessibility needs. Example input: {"team": "platform"}.',
  input: z.object({ team: z.string().min(1).describe('Team id or name, for example "platform" or "Platform team"') }),
  async execute({ team }) {
    const found = getTeam(team);
    if (!found) return unknownTeam(team);
    const needs = teamNeeds(found);
    return ok(
      `${found.name} team: ${found.members.length} people; needs: ${describeNeeds(needs)}.`,
      { id: found.id, name: found.name, size: found.members.length, members: found.members, needs },
      [internalSource("team.json")],
    );
  },
});
