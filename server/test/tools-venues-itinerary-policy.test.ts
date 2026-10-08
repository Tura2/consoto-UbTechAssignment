import { describe, expect, it } from "vitest";
import type { PolicyVerdict } from "../../shared/domain";
import { checkItinerary } from "../src/domain/itinerary-check";
import { allPlaces } from "../src/domain/places";
import { itinerarySubmitPlan, type ItineraryData } from "../src/tools/itinerary-submit-plan";
import { placesFindForTeam } from "../src/tools/places-find-for-team";
import { policyCheck } from "../src/tools/policy-check";
import { runTool, type ToolContext } from "../src/tools/types";
import { BASE_TRIP, LISBON_TRIP, makeCtx } from "./helpers/ctx";
import { fakeData } from "./helpers/fake-data";
import { GOOD_PLAN, LISBON_NEEDS, lisbonVenues } from "./helpers/lisbon";

function planningCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return makeCtx({ trip: LISBON_TRIP, findings: { venues: lisbonVenues(), itinerary: null }, ...overrides });
}

describe("places_find_for_team", () => {
  it("searches with the team's needs and summarizes what OSM has", async () => {
    let query = "";
    const base = fakeData();
    const ctx = makeCtx({ data: { ...base, overpass: (q, signal) => { query = q; return base.overpass(q, signal); } } });
    const result = await runTool(placesFindForTeam, { city: "Lisbon", team: "platform" }, ctx);
    expect(query).toContain("diet:kosher");
    expect(result).toMatchObject({
      ok: true,
      summary: "Lisbon: 5 food places match a team diet (4 vegan, 1 kosher, 3 gluten-free); 3 wheelchair-accessible sights.",
      gaps: ["No single place within 3 km is tagged for all of: vegan, kosher, gluten-free."],
    });
  });

  it("reports an Overpass outage as unavailable data", async () => {
    const ctx = makeCtx({ data: fakeData({ overpass: async () => { throw new Error("OpenStreetMap (Overpass): HTTP 504"); } }) });
    const result = await runTool(placesFindForTeam, { city: "Lisbon", team: "platform" }, ctx);
    expect(result).toMatchObject({ ok: false, error: { code: "source_unavailable", message: expect.stringContaining("504") } });
  });
});

describe("itinerary_submit_plan", () => {
  it("accepts a valid plan and returns place names for display", async () => {
    const result = await runTool(itinerarySubmitPlan, GOOD_PLAN, planningCtx());
    expect(result).toMatchObject({
      ok: true,
      summary: "Plan accepted: 3 days, 1 place needs an access check, 3 meals need catering.",
    });
    if (result.ok) expect((result.data as ItineraryData).placeNames["node/1831989609"]).toBe("Olha que Dois");
  });

  it("allows at most two submissions", async () => {
    const ctx = planningCtx();
    await runTool(itinerarySubmitPlan, GOOD_PLAN, ctx);
    await runTool(itinerarySubmitPlan, GOOD_PLAN, ctx);
    const third = await runTool(itinerarySubmitPlan, GOOD_PLAN, ctx);
    expect(third).toMatchObject({ ok: false, error: { code: "submission_limit" } });
  });

  it("needs the venue list and a start date", async () => {
    expect(await runTool(itinerarySubmitPlan, GOOD_PLAN, makeCtx({ trip: LISBON_TRIP }))).toMatchObject({ ok: false, error: { code: "no_venues" } });
    expect(await runTool(itinerarySubmitPlan, GOOD_PLAN, planningCtx({ trip: { ...LISBON_TRIP, start: null } }))).toMatchObject({
      ok: false,
      error: { code: "no_dates" },
    });
  });
});

describe("policy_check", () => {
  const itinerary = { plan: GOOD_PLAN, check: checkItinerary(GOOD_PLAN, { start: "2027-03-16", days: 3 }, allPlaces(lisbonVenues()), LISBON_NEEDS) };

  it("gives the verdict for the drafted Lisbon plan", async () => {
    const result = await runTool(policyCheck, {}, planningCtx({ findings: { venues: lisbonVenues(), itinerary } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = result.data as PolicyVerdict;
    expect(verdict.rules.map((r) => r.status)).toEqual(["pass", "pass", "pass", "needs_action", "needs_action", "pass"]);
    expect(result.summary).toBe("Within policy if the listed actions are taken: 4 passed, 0 failed, 2 need action, 0 unknown.");
  });

  it("re-runs the rules when she asks for 4 days", async () => {
    const result = await runTool(policyCheck, {}, planningCtx({ trip: { ...LISBON_TRIP, days: 4, nights: 3 } }));
    const verdict = (result.ok ? result.data : null) as PolicyVerdict;
    expect(verdict.rules[0]).toMatchObject({ status: "fail", fix: "Shorten to 3 days and 2 nights: 3,036 ILS per person." });
  });

  it("flags dates on Purim and suggests clean ones", async () => {
    const result = await runTool(policyCheck, {}, planningCtx({ trip: { ...LISBON_TRIP, start: { date: "2027-03-22", source: "user" } } }));
    const verdict = (result.ok ? result.data : null) as PolicyVerdict;
    expect(verdict.rules[2]).toMatchObject({
      status: "fail",
      fix: "Move to 2027-03-19 to 2027-03-21 or 2027-03-18 to 2027-03-20 or 2027-03-17 to 2027-03-19.",
    });
  });

  it("lists cheaper cities when Barcelona for 4 days is over budget", async () => {
    const result = await runTool(policyCheck, {}, planningCtx({ trip: { ...LISBON_TRIP, city: "Barcelona", days: 4, nights: 3 } }));
    const verdict = (result.ok ? result.data : null) as PolicyVerdict;
    expect(verdict.rules[1].fix).toBe(
      "Needs CFO approval, or switch to a city that fits: Budapest (2,762 ILS), Athens (2,848 ILS), Prague (2,882 ILS), Lisbon (3,843 ILS).",
    );
  });

  it("keeps going when the ECB rate is down", async () => {
    const ctx = planningCtx({ data: fakeData({ ecbRate: async () => { throw new Error("Frankfurter: HTTP 503"); } }) });
    const result = await runTool(policyCheck, {}, ctx);
    const verdict = (result.ok ? result.data : null) as PolicyVerdict;
    expect(verdict.rules[1].status).toBe("unknown");
    expect(verdict.rules[5].status).toBe("unknown");
  });

  it("needs a city", async () => {
    const result = await runTool(policyCheck, {}, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: "no_city" } });
  });
});
