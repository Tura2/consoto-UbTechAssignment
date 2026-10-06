import { describe, expect, it } from "vitest";
import { ECB_RATE_URL, fetchEcbRate, parseEcbRate } from "../src/clients/frankfurter";
import fixture from "./fixtures/frankfurter-ecb.json";
import { fakeHttp } from "./helpers/fake-http";

describe("Frankfurter", () => {
  it("reads the ECB rate and keeps its own date", () => {
    expect(parseEcbRate(fixture)).toEqual({ value: 3.431, date: "2026-10-05" });
  });

  it("rejects an empty response", () => {
    expect(() => parseEcbRate([])).toThrow();
  });

  it("asks for the ECB provider only", async () => {
    const { http, calls } = fakeHttp(fixture);
    const result = await fetchEcbRate(http);
    expect(ECB_RATE_URL).toContain("providers=ECB");
    expect(calls[0].url).toBe(ECB_RATE_URL);
    expect(result.rate.value).toBe(3.431);
    expect(result.source.name).toBe("Frankfurter (ECB rate)");
  });
});
