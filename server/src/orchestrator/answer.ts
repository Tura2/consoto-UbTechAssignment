// The last step of a turn: one streamed LLM call that writes the reply from the agents' data.
import type { Place, PolicyVerdict, Trip, VenuesResult } from "../../../shared/domain";
import type { Emit } from "../../../shared/events";
import type { AgentResult } from "../agents/runner";
import type { ChatMessage, Llm } from "../llm/openrouter";
import type { CostData } from "../tools/budget-estimate-cost";
import type { CalendarData } from "../tools/calendar-find-clean-windows";
import type { ItineraryData } from "../tools/itinerary-submit-plan";
import type { WeatherData } from "../tools/weather-get-outlook";
import type { Plan } from "./plan";

export const ANSWER_RULES = `You are Consoto's offsite planning assistant, talking to Maya, Head of AI at Consoto. Reply to her latest message using only the facts in CONTEXT.
Rules:
- Use only numbers, dates, prices and place names that appear in CONTEXT. Never calculate or estimate new ones.
- Result cards with the full tables are shown with your reply. Mention only the key numbers and point to the cards for details.
- If CONTEXT lists gaps or failed tools, say plainly what you could not find. Never fill a gap.
- If the trip start date was assumed, say which dates you assumed and that she can pick others.
- If the weather is a climate average, say it is an average of past years, not a forecast.
- When a policy verdict is present and relevant, state it clearly with the fixes it lists.
- When asked to recommend, recommend, with reasons taken from CONTEXT.
- Name your sources briefly, for example "ECB rate via Frankfurter" or "OpenStreetMap".
- Be concise: about 180 words at most. Markdown is fine, but no tables.`;

function truncate(data: unknown, max = 3_000): unknown {
  const text = JSON.stringify(data);
  return text.length <= max ? data : `${text.slice(0, max)}... (truncated)`;
}

const brief = (place: Place) => `${place.name} [${place.diets.join(", ") || "no diet tags"}; wheelchair ${place.wheelchair}]`;

// What the answer model needs from each tool, without the bulk.
export function compactForAnswer(tool: string, data: unknown): unknown {
  switch (tool) {
    case "budget_estimate_cost": {
      const cost = data as CostData;
      return {
        days: cost.days,
        nights: cost.nights,
        teamSize: cost.teamSize,
        ecbRate: cost.rate,
        unknownCities: cost.unknownCities,
        perCity: cost.estimates.map((e) => ({
          city: e.city,
          perPersonEur: e.perPersonEur,
          perPersonIls: e.perPersonIls,
          teamTotalIls: e.teamTotalIls,
          withinBudget: e.withinBudget,
          headroomIls: e.headroomIls,
        })),
      };
    }
    case "calendar_find_clean_windows":
      return (data as CalendarData).cities.map((city) => ({
        city: city.city,
        holidays: city.holidays.map((h) => `${h.date} ${h.name} (${h.country})`),
        cleanWindows: city.windows
          .filter((w) => w.clean)
          .map((w) => `${w.start} to ${w.end} (${w.weekdays.join("-")})${w.israeliWeekendDays.length ? ", includes the Israeli weekend" : ""}`),
      }));
    case "weather_get_outlook":
      return (data as WeatherData).cities.map((city) => ({ city: city.city, ...city.outlook }));
    case "places_find_for_team": {
      const venues = data as VenuesResult;
      return {
        city: venues.city,
        counts: venues.counts,
        bestFood: venues.bestFood.map(brief),
        byNeed: Object.fromEntries(Object.entries(venues.byNeed).map(([need, places]) => [need, (places ?? []).map(brief)])),
        sights: venues.sights.map(brief),
        gaps: venues.gaps,
      };
    }
    case "itinerary_submit_plan": {
      const { plan, check, placeNames } = data as ItineraryData;
      return {
        days: plan.days.map((day) => ({
          date: day.date,
          items: day.items.map((item) => ({
            slot: item.slot,
            places: item.venueIds.map((id) => placeNames[id] ?? id),
            catering: item.catering,
            note: item.note,
          })),
        })),
        problems: check.problems,
        toConfirm: check.notes,
        cateringNeeded: check.mealsCoveredByCatering,
      };
    }
    default:
      return truncate(data);
  }
}

export function buildAnswerContext(args: { trip: Trip; plan: Plan; results: AgentResult[]; policy: PolicyVerdict | null }): string {
  const agents = args.results.map((result) => ({
    agent: result.agent,
    status: result.status,
    summary: result.summary,
    tools: result.toolRuns.map((run) =>
      run.result.ok
        ? {
            tool: run.tool,
            summary: run.result.summary,
            gaps: run.result.gaps,
            sources: [...new Set(run.result.sources.map((source) => source.name))],
            data: compactForAnswer(run.tool, run.result.data),
          }
        : { tool: run.tool, failed: run.result.error.message },
    ),
  }));
  const policy = args.policy
    ? { overall: args.policy.overall, rules: args.policy.rules.map(({ id, status, detail, fix }) => ({ id, status, detail, fix })) }
    : null;
  return JSON.stringify(
    { trip: args.trip, tripStartAssumed: args.trip.start?.source === "assumed", orchestratorReason: args.plan.reason, agents, policy },
    null,
    1,
  );
}

export async function streamAnswer(args: {
  llm: Llm;
  history: ChatMessage[];
  message: string;
  context: string;
  signal: AbortSignal;
  emit: Emit;
}): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: `${ANSWER_RULES}\n\nCONTEXT:\n${args.context}` },
    ...args.history,
    { role: "user", content: args.message },
  ];
  const { text } = await args.llm.stream({ who: "answer", messages, maxTokens: 3_000, signal: args.signal }, args.emit, (delta) =>
    args.emit({ type: "answer_delta", text: delta }),
  );
  return text;
}
