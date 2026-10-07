import { describe, expect, it } from "vitest";
import { sourceGroups } from "./sources";
import type { StepView } from "./state/turnReducer";

const source = (name: string, url: string) => ({ name, url, fetchedAt: "2026-03-01T00:00:00Z", cached: false });
const step = (status: StepView["status"], sources: StepView["sources"]): StepView => ({
  callId: "c", owner: "venues", tool: "t", input: {}, status, summary: "", data: null, sources, gaps: [], cached: false, ms: 1,
});

describe("sourceGroups", () => {
  it("groups sources by provider, from successful steps only, keeping the details", () => {
    const result = sourceGroups([
      step("ok", [source("Nager.Date (Portugal public holidays)", "https://date.nager.at/pt"), source("Frankfurter (ECB rate)", "https://frankfurter.dev")]),
      step("ok", [source("Nager.Date (Spain public holidays)", "https://date.nager.at/es"), source("Open-Meteo (historical weather)", "https://archive-api.open-meteo.com")]),
      step("error", [source("Hebcal (Israeli holidays)", "https://hebcal.com")]),
    ]);
    expect(result).toEqual([
      { provider: "Nager.Date", url: "https://date.nager.at/pt", details: ["Portugal public holidays", "Spain public holidays"] },
      { provider: "Frankfurter", url: "https://frankfurter.dev", details: ["ECB rate"] },
      { provider: "Open-Meteo", url: "https://archive-api.open-meteo.com", details: ["historical weather"] },
    ]);
  });

  it("links a provider only through a web address", () => {
    const result = sourceGroups([step("ok", [source("Consoto internal data (costs.json)", "consoto-internal:costs.json"), source("Consoto internal data (team.json)", "consoto-internal:team.json")])]);
    expect(result).toEqual([{ provider: "Consoto internal data", url: null, details: ["costs.json", "team.json"] }]);
  });
});
