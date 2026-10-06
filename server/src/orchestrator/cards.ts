// Result cards built by code from tool data: every table and total on screen comes from here.
import type { PolicyVerdict, Trip, VenuesResult } from "../../../shared/domain";
import type { Card, ComparisonRow } from "../../../shared/events";
import type { AgentResult } from "../agents/runner";
import type { CostData } from "../tools/budget-estimate-cost";
import type { CalendarData } from "../tools/calendar-find-clean-windows";
import type { ItineraryData } from "../tools/itinerary-submit-plan";
import type { WeatherData } from "../tools/weather-get-outlook";
import { lastToolData } from "./tool-data";

export function buildCards(args: { results: AgentResult[]; policy: PolicyVerdict | null; showPolicy: boolean; trip: Trip }): Card[] {
  const { results, trip } = args;
  const cost = lastToolData<CostData>(results, "budget_estimate_cost");
  const calendar = lastToolData<CalendarData>(results, "calendar_find_clean_windows");
  const weather = lastToolData<WeatherData>(results, "weather_get_outlook");
  const venues = lastToolData<VenuesResult>(results, "places_find_for_team");
  const itinerary = lastToolData<ItineraryData>(results, "itinerary_submit_plan");
  const cards: Card[] = [];

  const cityCount = Math.max(cost?.estimates.length ?? 0, calendar?.cities.length ?? 0, weather?.cities.length ?? 0);
  if (cityCount > 1) {
    cards.push(comparisonCard(cost, calendar, weather, trip));
  } else {
    if (cost?.estimates[0]) cards.push({ kind: "cost", estimate: cost.estimates[0] });
    const dates = calendar?.cities[0];
    if (calendar && dates) {
      cards.push({ kind: "dates", city: dates.city, from: calendar.from, to: calendar.to, holidays: dates.holidays, windows: dates.windows });
    }
    const outlook = weather?.cities[0];
    if (outlook) cards.push({ kind: "weather", city: outlook.city, outlook: outlook.outlook });
  }
  if (venues) cards.push({ kind: "venues", result: venues });
  if (itinerary && trip.city) {
    cards.push({ kind: "itinerary", city: trip.city, plan: itinerary.plan, check: itinerary.check, placeNames: itinerary.placeNames });
  }
  if (args.policy && trip.city && (args.showPolicy || args.policy.overall === "outside_policy")) {
    cards.push({ kind: "policy", city: trip.city, verdict: args.policy });
  }
  return cards;
}

function comparisonCard(cost: CostData | null, calendar: CalendarData | null, weather: WeatherData | null, trip: Trip): Card {
  const cities = [
    ...new Set([
      ...(cost?.estimates.map((estimate) => estimate.city) ?? []),
      ...(calendar?.cities.map((entry) => entry.city) ?? []),
      ...(weather?.cities.map((entry) => entry.city) ?? []),
    ]),
  ];
  const rows: ComparisonRow[] = cities.map((city) => {
    const estimate = cost?.estimates.find((entry) => entry.city === city);
    const dates = calendar?.cities.find((entry) => entry.city === city);
    const outlook = weather?.cities.find((entry) => entry.city === city)?.outlook;
    return {
      city,
      perPersonIls: estimate?.perPersonIls ?? null,
      teamTotalIls: estimate?.teamTotalIls ?? null,
      withinBudget: estimate?.withinBudget ?? null,
      cleanWindows: dates ? dates.windows.filter((window) => window.clean).length : null,
      avgHighC: outlook?.kind === "climate_average" ? outlook.stats.avgHighC : null,
      rainyDayShare: outlook?.kind === "climate_average" ? outlook.stats.rainyDayShare : null,
    };
  });
  rows.sort((a, b) => (a.perPersonIls ?? Number.MAX_VALUE) - (b.perPersonIls ?? Number.MAX_VALUE));
  return { kind: "comparison", days: cost?.days ?? trip.days, nights: cost?.nights ?? trip.nights, rate: cost?.rate ?? null, rows };
}
