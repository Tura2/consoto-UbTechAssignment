import { describe, expect, it } from "vitest";
import { fetchIsraelHolidays, hebcalUrl, parseHebcal } from "../src/clients/hebcal";
import fixture from "./fixtures/hebcal-2027-03.json";
import { fakeHttp } from "./helpers/fake-http";

describe("Hebcal", () => {
  it("keeps holidays and drops fast days", () => {
    const items = parseHebcal(fixture);
    expect(items.map((h) => h.name)).toEqual(["Erev Purim", "Purim", "Shushan Purim"]);
    expect(items[1]).toEqual({ date: "2027-03-23", name: "Purim", side: "israel", country: "Israel", source: "Hebcal" });
  });

  it("asks for the Israel schedule without minor fasts", async () => {
    const url = hebcalUrl("2027-03-01", "2027-03-31");
    expect(url).toContain("i=on");
    expect(url).toContain("mf=off");
    expect(url).toContain("start=2027-03-01&end=2027-03-31");
    const { http, calls } = fakeHttp(fixture);
    await fetchIsraelHolidays(http, "2027-03-01", "2027-03-31");
    expect(calls[0].url).toBe(url);
  });
});
