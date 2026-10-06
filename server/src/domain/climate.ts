// Climate averages from past years: used when the trip is too far out for a forecast.
import type { ClimateStats } from "../../../shared/domain";
import { addDays } from "./dates";

export type DailySeries = {
  dates: string[];
  highC: (number | null)[];
  lowC: (number | null)[];
  rainMm: (number | null)[];
};

const ARCHIVE_DELAY_DAYS = 5;

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function shiftYear(iso: string, year: number): string {
  const monthDay = iso.slice(5);
  return monthDay === "02-29" && !isLeap(year) ? `${year}-02-28` : `${year}-${monthDay}`;
}

// The same calendar window, ending in `endYear` (handles windows that cross New Year).
export function windowInYear(from: string, to: string, endYear: number): { from: string; to: string } {
  const span = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return { from: shiftYear(from, endYear - span), to: shiftYear(to, endYear) };
}

// The last `count` years whose copy of the window is fully in the archive.
export function climateYears(from: string, to: string, today: string, count = 10): number[] {
  const latestData = addDays(today, -ARCHIVE_DELAY_DAYS);
  let year = Number(to.slice(0, 4));
  while (windowInYear(from, to, year).to > latestData) year--;
  return Array.from({ length: count }, (_, i) => year - count + 1 + i);
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const present = (values: (number | null)[]) => values.filter((value): value is number => value !== null);

export function climateStats(series: DailySeries[], years: number[]): ClimateStats {
  const highs = series.flatMap((s) => present(s.highC));
  const lows = series.flatMap((s) => present(s.lowC));
  const rain = series.flatMap((s) => present(s.rainMm));
  if (highs.length === 0 || lows.length === 0 || rain.length === 0) {
    throw new Error("No historical weather data for this window");
  }
  return {
    avgHighC: round(mean(highs), 1),
    avgLowC: round(mean(lows), 1),
    rainyDayShare: round(rain.filter((mm) => mm >= 1).length / rain.length, 2),
    avgRainMm: round(mean(rain), 1),
    years,
  };
}
