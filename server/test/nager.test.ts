import { describe, expect, it } from "vitest";
import { fetchCountryHolidays, nagerUrl, parseNagerHolidays } from "../src/clients/nager";
import portugal from "./fixtures/nager-pt-2027.json";
import spain from "./fixtures/nager-es-2027-spring.json";
import { fakeHttp } from "./helpers/fake-http";

describe("Nager.Date", () => {
  it("keeps national public holidays only when the city has no subdivision", () => {
    const items = parseNagerHolidays(portugal, { code: "PT", name: "Portugal", subdivisionCode: null });
    const names = items.map((h) => h.name);
    expect(names).toContain("Good Friday");
    expect(names).not.toContain("Carnival");
    expect(names).not.toContain("Azores Day");
    expect(names).not.toContain("St. Stephen's Day");
    expect(items).toHaveLength(13);
    expect(items.find((h) => h.date === "2027-03-26")).toEqual({
      date: "2027-03-26",
      name: "Good Friday",
      side: "destination",
      country: "Portugal",
      source: "Nager.Date",
    });
  });

  it("adds the regional holidays of the city's subdivision", () => {
    const items = parseNagerHolidays(spain, { code: "ES", name: "Spain", subdivisionCode: "ES-CT" });
    expect(items.map((h) => h.name)).toEqual(["New Year's Day", "Epiphany", "Good Friday", "Easter Monday"]);
  });

  it("uses the v4 endpoint on the new domain", async () => {
    const { http, calls } = fakeHttp(portugal);
    await fetchCountryHolidays(http, { code: "PT", name: "Portugal", subdivisionCode: null }, 2027);
    expect(nagerUrl("PT", 2027)).toBe("https://nagerholidays.com/api/v4/Holidays/PT/2027");
    expect(calls[0].url).toBe(nagerUrl("PT", 2027));
  });
});
