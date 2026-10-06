// Pure date logic. Dates are "YYYY-MM-DD" strings, handled in UTC so time zones never shift a day.
import type { DateWindow, HolidayItem } from "../../../shared/domain";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ISRAELI_WEEKEND = ["Fri", "Sat"];

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(date: string, n: number): string {
  return toIso(new Date(toDate(date).getTime() + n * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

export function weekday(date: string): string {
  return WEEKDAYS[toDate(date).getUTCDay()];
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type SearchPeriod = { month: number; part: "whole" | "first_half" | "second_half" };

// A month with no year means its next occurrence that has not fully passed.
export function resolveSearchPeriod(period: SearchPeriod, today: string): { from: string; to: string } {
  const build = (year: number) => {
    const fromDay = period.part === "second_half" ? 16 : 1;
    const toDay = period.part === "first_half" ? 15 : lastDayOfMonth(year, period.month);
    return { from: iso(year, period.month, fromDay), to: iso(year, period.month, toDay) };
  };
  const thisYear = build(Number(today.slice(0, 4)));
  return thisYear.to >= today ? thisYear : build(Number(today.slice(0, 4)) + 1);
}

// Returns null for dates that do not exist (for example February 30).
export function resolveStartDay(
  day: { month: number; day: number },
  window: { from: string; to: string } | null,
  today: string,
): string | null {
  const exists = (year: number) => day.day <= lastDayOfMonth(year, day.month);
  if (window) {
    for (const year of [Number(window.from.slice(0, 4)), Number(window.to.slice(0, 4))]) {
      const candidate = iso(year, day.month, day.day);
      if (exists(year) && candidate >= window.from && candidate <= window.to) return candidate;
    }
  }
  const year = Number(today.slice(0, 4));
  for (const candidateYear of [year, year + 1]) {
    const candidate = iso(candidateYear, day.month, day.day);
    if (exists(candidateYear) && candidate >= today) return candidate;
  }
  return null;
}

export function datesOf(start: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function describeWindow(start: string, days: number, blocking: HolidayItem[]): DateWindow {
  const dates = datesOf(start, days);
  const clashes = blocking.filter((holiday) => dates.includes(holiday.date));
  return {
    start,
    end: dates[dates.length - 1],
    weekdays: dates.map(weekday),
    clean: clashes.length === 0,
    clashes,
    israeliWeekendDays: dates.filter((date) => ISRAELI_WEEKEND.includes(weekday(date))),
  };
}

// Every run of `days` consecutive dates inside [from, to].
export function buildWindows(from: string, to: string, days: number, blocking: HolidayItem[]): DateWindow[] {
  const windows: DateWindow[] = [];
  for (let start = from; addDays(start, days - 1) <= to; start = addDays(start, 1)) {
    windows.push(describeWindow(start, days, blocking));
  }
  return windows;
}

export function nearestCleanWindows(windows: DateWindow[], target: string, limit = 3): DateWindow[] {
  const distance = (window: DateWindow) => Math.abs(daysBetween(target, window.start));
  return windows
    .filter((window) => window.clean)
    .sort((a, b) => distance(a) - distance(b) || a.start.localeCompare(b.start))
    .slice(0, limit);
}

// Open-Meteo forecasts reach 16 days including today.
export function forecastAvailable(to: string, today: string): boolean {
  return to <= addDays(today, 15);
}
