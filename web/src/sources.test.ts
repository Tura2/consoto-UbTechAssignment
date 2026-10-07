import { describe, expect, it } from "vitest";
import { uniqueSources } from "./sources";
import type { StepView } from "./state/turnReducer";

const source = (name: string, url: string) => ({ name, url, fetchedAt: "2026-03-01T00:00:00Z", cached: false });
const step = (status: StepView["status"], sources: StepView["sources"]): StepView => ({
  callId: "c", owner: "venues", tool: "t", input: {}, status, summary: "", data: null, sources, gaps: [], cached: false, ms: 1,
});

describe("uniqueSources", () => {
  it("keeps one entry per name, from successful steps only", () => {
    const result = uniqueSources([
      step("ok", [source("Open-Meteo", "https://open-meteo.com"), source("Frankfurter (ECB)", "https://frankfurter.dev")]),
      step("ok", [source("Open-Meteo", "https://archive-api.open-meteo.com")]),
      step("error", [source("Hebcal", "https://hebcal.com")]),
    ]);
    expect(result.map((s) => s.name)).toEqual(["Open-Meteo", "Frankfurter (ECB)"]);
  });

  it("prefers an entry with a link over one without", () => {
    const result = uniqueSources([step("ok", [source("Consoto internal data", "internal")]), step("ok", [source("Consoto internal data", "https://x.test")])]);
    expect(result[0].url).toBe("https://x.test");
  });
});
