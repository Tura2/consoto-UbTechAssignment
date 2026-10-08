// Fetches the demo's public API data once, so the live demo runs from the cache.
// Usage: npm run warm-cache (no API key needed). Safe to run again: cached steps are instant.
import { createDataSources } from "../clients/data-sources";
import { createHttp } from "../clients/http";
import { CACHE_DIR, USER_AGENT } from "../config";
import { listCities } from "../data/consoto-data";
import { resolveSearchPeriod } from "../domain/dates";
import { sleepMs } from "../lib/time";
import { newTrip } from "../orchestrator/trip";
import { todayIso } from "../runtime";
import { budgetEstimateCost } from "../tools/budget-estimate-cost";
import { calendarFindCleanWindows } from "../tools/calendar-find-clean-windows";
import { placesFindForTeam } from "../tools/places-find-for-team";
import { runTool, type AnyTool, type ToolContext } from "../tools/types";
import { weatherGetOutlook } from "../tools/weather-get-outlook";

const data = createDataSources(createHttp({ cacheDir: CACHE_DIR, userAgent: USER_AGENT }));
const today = todayIso();
const period = resolveSearchPeriod({ month: 3, part: "second_half" }, today);
const cities = listCities();
const ctx: ToolContext = {
  trip: { ...newTrip(), team: "platform", searchWindow: period, candidateCities: cities },
  findings: { venues: null, itinerary: null },
  data,
  signal: new AbortController().signal,
  today,
  scratch: {},
};

let failures = 0;
async function step(label: string, tool: AnyTool, input: unknown): Promise<void> {
  const result = await runTool(tool, input, ctx);
  console.log(`${result.ok ? "ok  " : "FAIL"} ${label}: ${result.summary}`);
  if (!result.ok) failures++;
}

console.log(`Warming the cache for ${period.from} to ${period.to}: ${cities.join(", ")}\n`);
await step("Costs and ECB rate", budgetEstimateCost, { cities, days: 3, team: "platform" });
await step("Holidays, all cities", calendarFindCleanWindows, { cities, from: period.from, to: period.to, days: 3 });
await step("Weather, all cities", weatherGetOutlook, { cities, from: period.from, to: period.to });
for (const city of cities) {
  await step(`Weather, ${city}`, weatherGetOutlook, { cities: [city], from: period.from, to: period.to });
  await step(`Places, ${city}`, placesFindForTeam, { city, team: "platform" });
  await sleepMs(5_000); // Overpass asks clients to pace their queries
}
console.log(failures === 0 ? "\nAll demo data is cached." : `\n${failures} steps failed. Run it again in a minute; cached steps are instant.`);
