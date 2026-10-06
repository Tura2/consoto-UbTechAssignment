import { describe, expect, it } from "vitest";
import { ils, pct, range, seconds, shortDate, shortModel } from "./format";

describe("format", () => {
  it("formats dates, money, shares, models and durations", () => {
    expect(shortDate("2027-03-16")).toBe("16 Mar");
    expect(range("2027-03-16", "2027-03-18")).toBe("16 Mar to 18 Mar");
    expect(range("2027-03-16", "2027-03-16")).toBe("16 Mar");
    expect(ils(36437)).toBe("36,437 ILS");
    expect(ils(null)).toBe("-");
    expect(pct(0.28)).toBe("28%");
    expect(shortModel("google/gemma-4-31b-it:free")).toBe("gemma-4-31b-it");
    expect(seconds(14234)).toBe("14.2 s");
  });
});
