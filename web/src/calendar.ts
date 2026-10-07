// The dates card's calendar strip: one entry per day of the search period, with its holidays and whether it
// falls on the Israeli weekend (Friday and Saturday). Dates are ISO strings read as UTC days.
import type { HolidayItem } from "../../shared/domain";

export type CalendarDay = { date: string; weekday: string; day: number; israel: string[]; destination: string[]; israeliWeekend: boolean };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function calendarDays(from: string, to: string, holidays: HolidayItem[]): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let date = new Date(`${from}T00:00:00Z`); date <= new Date(`${to}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const iso = date.toISOString().slice(0, 10);
    const onDay = holidays.filter((holiday) => holiday.date === iso);
    days.push({
      date: iso,
      weekday: WEEKDAYS[date.getUTCDay()],
      day: date.getUTCDate(),
      israel: onDay.filter((holiday) => holiday.side === "israel").map((holiday) => holiday.name),
      destination: onDay.filter((holiday) => holiday.side === "destination").map((holiday) => holiday.name),
      israeliWeekend: date.getUTCDay() === 5 || date.getUTCDay() === 6,
    });
  }
  return days;
}
