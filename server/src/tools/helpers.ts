// Helpers used by more than one tool.
import type { CityCost, HolidayItem, Source } from "../../../shared/domain";
import { getCityCosts, getDestination, getPolicy, matchCity, type Team, type TeamNeeds } from "../data/consoto-data";
import { estimateCityCost } from "../domain/cost";
import { lastDayOfMonth } from "../domain/dates";
import { DIET_LABELS } from "../domain/places";
import type { ToolContext } from "./types";

export function internalSource(file: string): Source {
  return { name: `Consoto internal data (${file})`, url: `consoto-internal:${file}`, fetchedAt: new Date().toISOString(), cached: false };
}

export function describeNeeds(needs: TeamNeeds): string {
  const parts = needs.diets.map((diet) => `${needs.dietCounts[diet]} ${DIET_LABELS[diet]}`);
  if (needs.wheelchairUsers > 0) parts.push(`${needs.wheelchairUsers} wheelchair ${needs.wheelchairUsers === 1 ? "user" : "users"}`);
  return parts.length > 0 ? parts.join(", ") : "none";
}

export function estimateFor(
  cities: string[],
  days: number,
  team: Team,
  rate: { value: number; date: string },
): { estimates: CityCost[]; unknownCities: string[] } {
  const policy = getPolicy();
  const estimates: CityCost[] = [];
  const unknownCities: string[] = [];
  for (const name of cities) {
    const city = matchCity(name);
    const rates = city ? getCityCosts(city) : null;
    if (!city || !rates) {
      unknownCities.push(name);
      continue;
    }
    estimates.push(
      estimateCityCost({
        city,
        rates,
        days,
        nights: days - 1,
        teamSize: team.members.length,
        rate,
        budgetIlsPerPerson: policy.budgetIlsPerPerson,
      }),
    );
  }
  return { estimates, unknownCities };
}

// Holidays in Israel and at the destination between `from` and `to` (inclusive).
// Hebcal is asked for whole months so different tools share one cached request.
export async function holidaysBetween(
  city: string,
  from: string,
  to: string,
  ctx: ToolContext,
): Promise<{ items: HolidayItem[]; sources: Source[] } | null> {
  const destination = getDestination(city);
  if (!destination) return null;
  const endYear = Number(to.slice(0, 4));
  const monthStart = `${from.slice(0, 7)}-01`;
  const monthEnd = `${to.slice(0, 7)}-${String(lastDayOfMonth(endYear, Number(to.slice(5, 7)))).padStart(2, "0")}`;
  const years = [...new Set([Number(from.slice(0, 4)), endYear])];
  const country = { code: destination.countryCode, name: destination.country, subdivisionCode: destination.subdivisionCode };
  const [israel, ...local] = await Promise.all([
    ctx.data.israelHolidays(monthStart, monthEnd, ctx.signal),
    ...years.map((year) => ctx.data.countryHolidays(country, year, ctx.signal)),
  ]);
  const items = [...israel.items, ...local.flatMap((result) => result.items)]
    .filter((holiday) => holiday.date >= from && holiday.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.side === "israel" ? -1 : 1));
  return { items, sources: [israel.source, ...local.map((result) => result.source)] };
}

export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.name}|${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
