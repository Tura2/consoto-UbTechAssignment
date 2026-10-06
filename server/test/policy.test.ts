import { describe, expect, it } from "vitest";
import type { HolidayItem, ItineraryCheck, Trip } from "../../shared/domain";
import { getCityCosts, getPolicy, listCities } from "../src/data/consoto-data";
import { estimateCityCost } from "../src/domain/cost";
import { buildWindows, describeWindow, nearestCleanWindows } from "../src/domain/dates";
import { checkPolicy, overallOf, type PolicyInput } from "../src/domain/policy";

const RATE = { value: 3.431, date: "2026-10-05" };
const HOLIDAYS: HolidayItem[] = [
  { date: "2027-03-22", name: "Erev Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-23", name: "Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-24", name: "Shushan Purim", side: "israel", country: "Israel", source: "Hebcal" },
  { date: "2027-03-26", name: "Good Friday", side: "destination", country: "Portugal", source: "Nager.Date" },
  { date: "2027-03-28", name: "Easter Sunday", side: "destination", country: "Portugal", source: "Nager.Date" },
];
const TRIP: Trip = {
  team: "platform",
  region: "Europe",
  searchWindow: { from: "2027-03-16", to: "2027-03-31" },
  candidateCities: [],
  city: "Lisbon",
  start: { date: "2027-03-16", source: "assumed" },
  days: 3,
  nights: 2,
};
const ITINERARY: ItineraryCheck = {
  accepted: true,
  problems: [],
  notes: [],
  uncoveredMeals: [],
  mealsCoveredByCatering: ["Day 1 lunch: kosher catering"],
  inaccessible: [],
  accessToConfirm: ["Olha que Dois"],
};

function cost(city: string, days: number) {
  return estimateCityCost({
    city,
    rates: getCityCosts(city)!,
    days,
    nights: days - 1,
    teamSize: 12,
    rate: RATE,
    budgetIlsPerPerson: 4000,
  });
}

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  const windows = buildWindows("2027-03-16", "2027-03-31", 3, HOLIDAYS);
  return {
    policy: getPolicy(),
    trip: TRIP,
    cost: cost("Lisbon", 3),
    costAtMaxLength: null,
    alternatives: [],
    dates: { window: describeWindow("2027-03-16", 3, HOLIDAYS), nearestClean: nearestCleanWindows(windows, "2027-03-16") },
    itinerary: ITINERARY,
    rate: RATE,
    ...overrides,
  };
}

const statuses = (verdict: ReturnType<typeof checkPolicy>) => verdict.rules.map((rule) => rule.status);

describe("checkPolicy", () => {
  it("is within policy if the catering is booked and access is confirmed", () => {
    const verdict = checkPolicy(input());
    expect(statuses(verdict)).toEqual(["pass", "pass", "pass", "needs_action", "needs_action", "pass"]);
    expect(verdict.overall).toBe("within_policy_if_actions");
    expect(verdict.rules[1].detail).toBe("3,036 ILS per person, 964 ILS under the 4,000 ILS limit.");
    expect(verdict.rules[3].fix).toBe("Book the catering for those meals.");
    expect(verdict.rules[4].fix).toBe("Confirm step-free access with Olha que Dois.");
    expect(verdict.rules[0].rule).toBe("An offsite is max 3 days and 2 nights.");
  });

  it("fails a 4-day trip and offers the 3-day price", () => {
    const verdict = checkPolicy(
      input({ trip: { ...TRIP, days: 4, nights: 3 }, cost: cost("Lisbon", 4), costAtMaxLength: cost("Lisbon", 3) }),
    );
    expect(verdict.rules[0]).toMatchObject({
      status: "fail",
      detail: "4 days and 3 nights; the maximum is 3 days and 2 nights.",
      fix: "Shorten to 3 days and 2 nights: 3,036 ILS per person.",
    });
    expect(verdict.overall).toBe("outside_policy");
  });

  it("fails an over-budget trip and lists the cities that fit", () => {
    const alternatives = listCities().map((city) => cost(city, 4));
    const verdict = checkPolicy(
      input({ trip: { ...TRIP, city: "Barcelona", days: 4, nights: 3 }, cost: cost("Barcelona", 4), alternatives }),
    );
    expect(verdict.rules[1]).toMatchObject({
      status: "fail",
      detail: "4,117 ILS per person, 117 ILS over the 4,000 ILS limit.",
      fix: "Needs CFO approval, or switch to a city that fits: Budapest (2,762 ILS), Athens (2,848 ILS), Prague (2,882 ILS), Lisbon (3,843 ILS).",
    });
  });

  it("fails dates on a holiday and suggests the nearest clean windows", () => {
    const windows = buildWindows("2027-03-16", "2027-03-31", 3, HOLIDAYS);
    const verdict = checkPolicy(
      input({ dates: { window: describeWindow("2027-03-22", 3, HOLIDAYS), nearestClean: nearestCleanWindows(windows, "2027-03-22") } }),
    );
    expect(verdict.rules[2]).toMatchObject({
      status: "fail",
      detail: "2027-03-22 to 2027-03-24 clashes with Erev Purim (Israel, 2027-03-22), Purim (Israel, 2027-03-23), Shushan Purim (Israel, 2027-03-24).",
      fix: "Move to 2027-03-19 to 2027-03-21 or 2027-03-18 to 2027-03-20 or 2027-03-17 to 2027-03-19.",
    });
  });

  it("says what it does not know yet", () => {
    const verdict = checkPolicy(input({ dates: null, itinerary: null, rate: null, cost: null }));
    expect(statuses(verdict)).toEqual(["pass", "unknown", "unknown", "unknown", "unknown", "unknown"]);
    expect(verdict.overall).toBe("not_enough_data");
    expect(verdict.rules[1].detail).toBe("No cost estimate for Lisbon.");
  });

  it("fails meals with no option and places tagged not accessible", () => {
    const verdict = checkPolicy(
      input({ itinerary: { ...ITINERARY, uncoveredMeals: ["Day 1 dinner: no option for kosher"], inaccessible: ["Ao 26"] } }),
    );
    expect(verdict.rules[3].status).toBe("fail");
    expect(verdict.rules[4]).toMatchObject({ status: "fail", fix: "Replace Ao 26." });
  });

  it("ranks fail over needs_action over unknown", () => {
    const rule = (status: "pass" | "fail" | "needs_action" | "unknown") => ({ id: 1, rule: "", status, detail: "", fix: null });
    expect(overallOf([rule("pass"), rule("unknown"), rule("needs_action")])).toBe("within_policy_if_actions");
    expect(overallOf([rule("fail"), rule("needs_action")])).toBe("outside_policy");
    expect(overallOf([rule("pass"), rule("pass")])).toBe("within_policy");
  });
});
