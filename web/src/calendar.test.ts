import { describe, expect, it } from "vitest";
import { calendarDays } from "./calendar";

const holiday = (date: string, name: string, side: "israel" | "destination") => ({ date, name, side, country: side === "israel" ? "Israel" : "Portugal", source: "x" });

describe("calendarDays", () => {
  it("lists every day of the period with its holidays and the Israeli weekend", () => {
    const days = calendarDays("2027-03-25", "2027-03-28", [
      holiday("2027-03-26", "Good Friday", "destination"),
      holiday("2027-03-28", "Easter Sunday", "destination"),
      holiday("2027-03-28", "Some Israeli day", "israel"),
    ]);
    expect(days).toEqual([
      { date: "2027-03-25", weekday: "Thu", day: 25, israel: [], destination: [], israeliWeekend: false },
      { date: "2027-03-26", weekday: "Fri", day: 26, israel: [], destination: ["Good Friday"], israeliWeekend: true },
      { date: "2027-03-27", weekday: "Sat", day: 27, israel: [], destination: [], israeliWeekend: true },
      { date: "2027-03-28", weekday: "Sun", day: 28, israel: ["Some Israeli day"], destination: ["Easter Sunday"], israeliWeekend: false },
    ]);
  });

  it("returns one day when the period is a single date", () => {
    expect(calendarDays("2027-03-16", "2027-03-16", [])).toHaveLength(1);
  });
});
