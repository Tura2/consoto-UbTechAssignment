// Code graders for scenario evals: they check outcomes (plan, cards, trip, answer), never ask a model.
import type { AgentId, RuleStatus, Trip } from "../../../shared/domain";
import type { Card, StreamEvent } from "../../../shared/events";
import { getCityCosts, getPolicy } from "../data/consoto-data";
import { estimateCityCost } from "../domain/cost";

export type GraderInput = { events: StreamEvent[]; trip: Trip; answer: string };
export type Grader = { name: string; check(input: GraderInput): string | null }; // null means pass

const cards = (events: StreamEvent[]): Card[] => events.flatMap((event) => (event.type === "card" ? [event.card] : []));
function cardOf<K extends Card["kind"]>(events: StreamEvent[], kind: K): Extract<Card, { kind: K }> | null {
  return (cards(events).find((card) => card.kind === kind) as Extract<Card, { kind: K }> | undefined) ?? null;
}

export const turnSucceeded: Grader = {
  name: "turn finished",
  check: ({ events }) => {
    const end = events.find((event) => event.type === "turn_end");
    return end?.type === "turn_end" && end.status === "done" ? null : `turn ended with ${end?.type === "turn_end" ? `${end.status}: ${end.error}` : "no turn_end"}`;
  },
};

export const planIncludes = (...agents: AgentId[]): Grader => ({
  name: `plan includes ${agents.join(" + ")}`,
  check: ({ events }) => {
    const plan = events.find((event) => event.type === "plan");
    if (plan?.type !== "plan") return "no plan event";
    const chosen = plan.agents.map((entry) => entry.agent);
    const missing = agents.filter((agent) => !chosen.includes(agent));
    return missing.length > 0 ? `missing ${missing.join(", ")} (chose ${chosen.join(", ") || "none"})` : null;
  },
});

export const comparisonHasCities = (count: number): Grader => ({
  name: `comparison card has ${count} cities`,
  check: ({ events }) => {
    const card = cardOf(events, "comparison");
    return card?.rows.length === count ? null : `found ${card ? card.rows.length : "no"} rows`;
  },
});

export const cityCostMatchesCode = (city: string): Grader => ({
  name: `${city} per-person cost matches the code`,
  check: ({ events }) => {
    const card = cardOf(events, "comparison");
    const row = card?.rows.find((entry) => entry.city === city);
    const rates = getCityCosts(city);
    if (!card?.rate || !row || !rates) return "no comparison row with an ECB rate";
    const expected = estimateCityCost({
      city,
      rates,
      days: card.days,
      nights: card.nights,
      teamSize: 12,
      rate: card.rate,
      budgetIlsPerPerson: getPolicy().budgetIlsPerPerson,
    }).perPersonIls;
    return row.perPersonIls === expected ? null : `expected ${expected}, got ${row.perPersonIls}`;
  },
});

export const weatherIsClimateAverage: Grader = {
  name: "weather is a labeled climate average",
  check: ({ events }) => (cardOf(events, "weather")?.outlook.kind === "climate_average" ? null : "no climate-average weather card"),
};

export const datesInclude = (date: string, name: string): Grader => ({
  name: `dates card lists ${name} on ${date}`,
  check: ({ events }) => (cardOf(events, "dates")?.holidays.some((h) => h.date === date && h.name.includes(name)) ? null : "holiday not listed"),
});

export const hasCard = (kind: Card["kind"]): Grader => ({
  name: `has a ${kind} card`,
  check: ({ events }) => (cardOf(events, kind) ? null : `no ${kind} card`),
});

export const itineraryDays = (days: number): Grader => ({
  name: `itinerary has ${days} days`,
  check: ({ events }) => {
    const card = cardOf(events, "itinerary");
    return card?.plan.days.length === days ? null : `found ${card ? card.plan.days.length : "no"} days`;
  },
});

export const teamTotalMatches: Grader = {
  name: "team total is per-person cost times team size, at the ECB rate",
  check: ({ events }) => {
    const estimate = cardOf(events, "cost")?.estimate;
    if (!estimate) return "no cost card";
    const expected = Math.round(estimate.perPersonEur * estimate.rate.value * estimate.teamSize);
    return estimate.teamSize === 12 && estimate.teamTotalIls === expected ? null : `expected ${expected} for 12, got ${estimate.teamTotalIls} for ${estimate.teamSize}`;
  },
};

export const policyRule = (id: number, status: RuleStatus): Grader => ({
  name: `policy rule ${id} is ${status}`,
  check: ({ events }) => {
    const rule = cardOf(events, "policy")?.verdict.rules.find((entry) => entry.id === id);
    return rule?.status === status ? null : `rule ${id} is ${rule?.status ?? "missing"}`;
  },
});

export const policyFixMentions = (id: number, pattern: RegExp): Grader => ({
  name: `policy rule ${id} fix matches ${pattern}`,
  check: ({ events }) => {
    const fix = cardOf(events, "policy")?.verdict.rules.find((entry) => entry.id === id)?.fix ?? "";
    return pattern.test(fix) ? null : `fix was "${fix}"`;
  },
});

export const tripDays = (days: number): Grader => ({
  name: `trip is ${days} days`,
  check: ({ trip }) => (trip.days === days ? null : `expected ${days} days, got ${trip.days}`),
});

export const tripCity = (city: string): Grader => ({
  name: `trip city is ${city}`,
  check: ({ trip }) => (trip.city === city ? null : `trip city is ${trip.city}`),
});

export const costCardFor = (city: string): Grader => ({
  name: `cost card is for ${city}`,
  check: ({ events }) => (cardOf(events, "cost")?.estimate.city === city ? null : "no cost card for this city"),
});

export const gapMentions = (pattern: RegExp): Grader => ({
  name: `a tool reported a gap matching ${pattern}`,
  check: ({ events }) =>
    events.some((event) => event.type === "tool_end" && (pattern.test(event.summary) || event.gaps.some((gap) => pattern.test(gap))))
      ? null
      : "no matching gap",
});

export const answerMentions = (pattern: RegExp): Grader => ({
  name: `answer matches ${pattern}`,
  check: ({ answer }) => (pattern.test(answer) ? null : `the answer does not match ${pattern}`),
});
