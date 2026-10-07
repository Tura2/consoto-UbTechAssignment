import { describe, expect, it } from "vitest";
import { cleanAnswer } from "../../shared/text";

describe("cleanAnswer", () => {
  it("removes tool-name citations", () => {
    expect(cleanAnswer("Lisbon costs 4,100 ILS per person 【budget_estimate_cost】.")).toBe("Lisbon costs 4,100 ILS per person.");
  });

  it("removes an unclosed citation at the end while streaming", () => {
    expect(cleanAnswer("Lisbon costs 4,100 ILS 【budget_")).toBe("Lisbon costs 4,100 ILS");
  });

  it("replaces em and en dashes with a plain hyphen", () => {
    expect(cleanAnswer("Mar 26–28 — all clean")).toBe("Mar 26-28 - all clean");
  });

  it("leaves plain text alone", () => {
    expect(cleanAnswer("Within policy: 3 days, 2 nights.")).toBe("Within policy: 3 days, 2 nights.");
  });
});
