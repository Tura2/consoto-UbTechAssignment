// The only code that reads Consoto's internal data. The rest of the app calls these functions.
// For a real customer, this module would call their API or an MCP server instead of reading files.
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DietNeed } from "../../../shared/domain";

const Diet = z.enum(["vegan", "kosher", "gluten_free"]);
const MemberSchema = z.object({
  name: z.string(),
  role: z.string(),
  dietary: Diet.nullable(),
  accessibility: z.literal("wheelchair").nullable(),
});
const TeamFileSchema = z.object({
  teams: z.record(z.string(), z.object({ name: z.string(), members: z.array(MemberSchema).min(1) })),
});
const PolicySchema = z.object({
  maxDays: z.number().int().positive(),
  maxNights: z.number().int().nonnegative(),
  budgetIlsPerPerson: z.number().positive(),
  overBudgetApprover: z.string(),
  plannedCurrency: z.literal("EUR"),
  reportedCurrency: z.literal("ILS"),
  rateSource: z.literal("ECB"),
  rules: z.array(z.object({ id: z.number().int(), text: z.string() })).length(6),
});
const CityCostsSchema = z.object({
  returnFlight: z.number(),
  hotelPerNight: z.number(),
  mealsPerDay: z.number(),
  activitiesPerDay: z.number(),
});
const CostsFileSchema = z.object({ currency: z.literal("EUR"), cities: z.record(z.string(), CityCostsSchema) });
const DestinationSchema = z.object({
  countryCode: z.string().length(2),
  country: z.string(),
  subdivisionCode: z.string().nullable(),
  region: z.string(),
});
const DestinationsFileSchema = z.object({ note: z.string(), cities: z.record(z.string(), DestinationSchema) });

export type Member = z.infer<typeof MemberSchema>;
export type Team = { id: string; name: string; members: Member[] };
export type Policy = z.infer<typeof PolicySchema>;
export type CityCosts = z.infer<typeof CityCostsSchema>;
export type Destination = z.infer<typeof DestinationSchema> & { city: string };
export type TeamNeeds = {
  diets: DietNeed[];
  dietCounts: Partial<Record<DietNeed, number>>;
  wheelchairUsers: number;
};

function readJson<T>(relativePath: string, schema: z.ZodType<T>): T {
  const raw = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return schema.parse(JSON.parse(raw));
}

// Validated once at startup, so a broken data file fails fast with a clear zod error.
const teams = readJson("./consoto/team.json", TeamFileSchema).teams;
const policy = readJson("./consoto/policy.json", PolicySchema);
const costs = readJson("./consoto/costs.json", CostsFileSchema).cities;
const destinations = readJson("./reference/destinations.json", DestinationsFileSchema).cities;

const DIET_ORDER: DietNeed[] = ["vegan", "kosher", "gluten_free"];

export function normalizeTeamId(input: string): string {
  return input.trim().toLowerCase().replace(/\s+team$/, "");
}

export function getTeam(id: string): Team | null {
  const key = normalizeTeamId(id);
  const team = teams[key];
  return team ? { id: key, ...team } : null;
}

export function listTeams(): string[] {
  return Object.keys(teams);
}

export function teamNeeds(team: Team): TeamNeeds {
  const dietCounts: Partial<Record<DietNeed, number>> = {};
  for (const member of team.members) {
    if (member.dietary) dietCounts[member.dietary] = (dietCounts[member.dietary] ?? 0) + 1;
  }
  return {
    diets: DIET_ORDER.filter((diet) => dietCounts[diet]),
    dietCounts,
    wheelchairUsers: team.members.filter((member) => member.accessibility === "wheelchair").length,
  };
}

export function getPolicy(): Policy {
  return policy;
}

function findKey(record: Record<string, unknown>, name: string): string | null {
  const wanted = name.trim().toLowerCase();
  return Object.keys(record).find((key) => key.toLowerCase() === wanted) ?? null;
}

export function matchCity(name: string): string | null {
  return findKey(costs, name);
}

export function getCityCosts(city: string): CityCosts | null {
  const key = findKey(costs, city);
  return key ? costs[key] : null;
}

export function listCities(): string[] {
  return Object.keys(costs);
}

export function getDestination(city: string): Destination | null {
  const key = findKey(destinations, city);
  return key ? { city: key, ...destinations[key] } : null;
}

export function citiesInRegion(region: string): string[] {
  const wanted = region.trim().toLowerCase();
  return listCities().filter((city) => getDestination(city)?.region.toLowerCase() === wanted);
}
