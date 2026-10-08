import { describe, expect, it } from "vitest";
import { budgetEstimateCost, type CostData } from "../src/tools/budget-estimate-cost";
import { budgetGetTeam } from "../src/tools/budget-get-team";
import { runTool } from "../src/tools/types";
import { ALL_CITIES as ALL, makeCtx } from "./helpers/ctx";

describe("budget_get_team", () => {
  it("returns the team and its needs", async () => {
    const result = await runTool(budgetGetTeam, { team: "Platform team" }, makeCtx());
    expect(result).toMatchObject({
      ok: true,
      summary: "Platform team: 12 people; needs: 2 vegan, 1 kosher, 1 gluten-free, 1 wheelchair user.",
    });
  });

  it("says there is no data for an unknown team", async () => {
    const result = await runTool(budgetGetTeam, { team: "Data" }, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_team", hint: expect.stringContaining("platform") } });
  });
});

describe("budget_estimate_cost", () => {
  it("compares all five cities at the ECB rate", async () => {
    const result = await runTool(budgetEstimateCost, { cities: ALL, days: 3, team: "platform" }, makeCtx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toBe("5 cities, 3 days: 2,196 to 3,208 ILS per person (ECB 3.431 on 2026-10-05).");
    const data = result.data as CostData;
    expect(data.estimates.find((e) => e.city === "Lisbon")?.perPersonIls).toBe(3036);
    expect(result.sources.map((s) => s.name)).toContain("Frankfurter (ECB rate)");
  });

  it("describes one city in full", async () => {
    const result = await runTool(budgetEstimateCost, { cities: ["lisbon"], days: 3, team: "platform" }, makeCtx());
    expect(result).toMatchObject({
      ok: true,
      summary: "Lisbon, 3 days: 3,036 ILS per person, 36,437 ILS for 12 people (ECB 3.431 on 2026-10-05).",
    });
  });

  it("reports a city with no cost data as a gap", async () => {
    const result = await runTool(budgetEstimateCost, { cities: ["Rome"], days: 3, team: "platform" }, makeCtx());
    expect(result).toMatchObject({
      ok: true,
      summary: "No cost data for Rome.",
      gaps: ["No cost data for Rome. Cost data exists for: Lisbon, Barcelona, Athens, Prague, Budapest."],
    });
  });

  it("fails for an unknown team before calling the rate API", async () => {
    let called = false;
    const ctx = makeCtx();
    ctx.data = { ...ctx.data, ecbRate: async () => { called = true; throw new Error("should not be called"); } };
    const result = await runTool(budgetEstimateCost, { cities: ["Lisbon"], days: 3, team: "Data" }, ctx);
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_team" } });
    expect(called).toBe(false);
  });
});
