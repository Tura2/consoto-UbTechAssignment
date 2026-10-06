// Consoto's six offsite rules as code. Every status and fix is computed here, never by the model.
import type { CityCost, DateWindow, ItineraryCheck, PolicyRuleResult, PolicyVerdict, Trip } from "../../../shared/domain";
import { fmt } from "./format";

export type PolicyParams = {
  maxDays: number;
  maxNights: number;
  budgetIlsPerPerson: number;
  overBudgetApprover: string;
  rules: { id: number; text: string }[];
};

export type PolicyInput = {
  policy: PolicyParams;
  trip: Trip;
  cost: CityCost | null;
  costAtMaxLength: CityCost | null;
  alternatives: CityCost[];
  dates: { window: DateWindow; nearestClean: DateWindow[] } | null;
  itinerary: ItineraryCheck | null;
  rate: { value: number; date: string } | null;
};

type Outcome = Omit<PolicyRuleResult, "id" | "rule">;

function lengthRule({ policy, trip, costAtMaxLength }: PolicyInput): Outcome {
  if (trip.days <= policy.maxDays && trip.nights <= policy.maxNights) {
    return { status: "pass", detail: `${trip.days} days and ${trip.nights} nights (max ${policy.maxDays} and ${policy.maxNights}).`, fix: null };
  }
  const price = costAtMaxLength ? `: ${fmt(costAtMaxLength.perPersonIls)} ILS per person` : "";
  return {
    status: "fail",
    detail: `${trip.days} days and ${trip.nights} nights; the maximum is ${policy.maxDays} days and ${policy.maxNights} nights.`,
    fix: `Shorten to ${policy.maxDays} days and ${policy.maxNights} nights${price}.`,
  };
}

function budgetRule({ policy, trip, cost, alternatives }: PolicyInput): Outcome {
  if (!cost) {
    return { status: "unknown", detail: trip.city ? `No cost estimate for ${trip.city}.` : "No city chosen yet.", fix: null };
  }
  const limit = fmt(policy.budgetIlsPerPerson);
  if (cost.withinBudget) {
    return { status: "pass", detail: `${fmt(cost.perPersonIls)} ILS per person, ${fmt(cost.headroomIls)} ILS under the ${limit} ILS limit.`, fix: null };
  }
  const fits = alternatives
    .filter((option) => option.withinBudget && option.city !== cost.city)
    .sort((a, b) => a.perPersonIls - b.perPersonIls);
  const switchText = fits.length > 0
    ? `, or switch to a city that fits: ${fits.map((option) => `${option.city} (${fmt(option.perPersonIls)} ILS)`).join(", ")}`
    : "";
  return {
    status: "fail",
    detail: `${fmt(cost.perPersonIls)} ILS per person, ${fmt(-cost.headroomIls)} ILS over the ${limit} ILS limit.`,
    fix: `Needs ${policy.overBudgetApprover} approval${switchText}.`,
  };
}

function datesRule({ trip, dates }: PolicyInput): Outcome {
  if (!dates) {
    const detail = trip.start ? "Holiday data for these dates is unavailable right now." : "No dates chosen yet.";
    return { status: "unknown", detail, fix: null };
  }
  const { window, nearestClean } = dates;
  if (window.clean) {
    return { status: "pass", detail: `${window.start} to ${window.end} has no holidays in Israel or at the destination.`, fix: null };
  }
  const clashes = window.clashes.map((holiday) => `${holiday.name} (${holiday.country}, ${holiday.date})`).join(", ");
  const fix = nearestClean.length > 0
    ? `Move to ${nearestClean.map((option) => `${option.start} to ${option.end}`).join(" or ")}.`
    : "No clean dates in the search period; widen it.";
  return { status: "fail", detail: `${window.start} to ${window.end} clashes with ${clashes}.`, fix };
}

function mealsRule({ itinerary }: PolicyInput): Outcome {
  if (!itinerary) return { status: "unknown", detail: "No itinerary yet.", fix: null };
  if (itinerary.uncoveredMeals.length > 0) {
    return { status: "fail", detail: `${itinerary.uncoveredMeals.join("; ")}.`, fix: "Add a venue tagged for the missing diet, or book catering for those meals." };
  }
  if (itinerary.mealsCoveredByCatering.length > 0) {
    return { status: "needs_action", detail: `Covered only with catering: ${itinerary.mealsCoveredByCatering.join("; ")}.`, fix: "Book the catering for those meals." };
  }
  return { status: "pass", detail: "Every meal has an option for every dietary need.", fix: null };
}

function accessRule({ itinerary }: PolicyInput): Outcome {
  if (!itinerary) return { status: "unknown", detail: "No itinerary yet.", fix: null };
  if (itinerary.inaccessible.length > 0) {
    const names = itinerary.inaccessible.join(", ");
    return { status: "fail", detail: `Tagged not wheelchair accessible: ${names}.`, fix: `Replace ${names}.` };
  }
  if (itinerary.accessToConfirm.length > 0) {
    const names = itinerary.accessToConfirm.join(", ");
    return { status: "needs_action", detail: `Wheelchair access is not recorded in OpenStreetMap for: ${names}.`, fix: `Confirm step-free access with ${names}.` };
  }
  return { status: "pass", detail: "Every place is tagged wheelchair accessible.", fix: null };
}

function currencyRule({ rate }: PolicyInput): Outcome {
  return rate
    ? { status: "pass", detail: `Planned in EUR, reported in ILS at the ECB rate ${rate.value} of ${rate.date}.`, fix: null }
    : { status: "unknown", detail: "The ECB rate is unavailable right now.", fix: null };
}

export function overallOf(rules: PolicyRuleResult[]): PolicyVerdict["overall"] {
  if (rules.some((rule) => rule.status === "fail")) return "outside_policy";
  if (rules.some((rule) => rule.status === "needs_action")) return "within_policy_if_actions";
  if (rules.some((rule) => rule.status === "unknown")) return "not_enough_data";
  return "within_policy";
}

export function checkPolicy(input: PolicyInput): PolicyVerdict {
  const outcomes = [lengthRule, budgetRule, datesRule, mealsRule, accessRule, currencyRule].map((rule) => rule(input));
  const rules = outcomes.map((outcome, index) => ({
    id: index + 1,
    rule: input.policy.rules.find((rule) => rule.id === index + 1)?.text ?? "",
    ...outcome,
  }));
  return { overall: overallOf(rules), rules };
}
