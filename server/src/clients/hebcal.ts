// Israeli holidays from Hebcal (Israel schedule). Every returned holiday blocks its date;
// minor fast days are not requested, and anything still marked as a fast is dropped.
import { z } from "zod";
import type { HolidayItem, Source } from "../../../shared/domain";
import type { Http } from "./http";

const WEEK = 7 * 86_400_000;

const HebcalBody = z.object({
  items: z.array(z.object({ title: z.string(), date: z.string(), category: z.string(), subcat: z.string().optional() })),
});

export function hebcalUrl(from: string, to: string): string {
  return (
    "https://www.hebcal.com/hebcal?v=1&cfg=json&i=on&maj=on&min=on&mod=on" +
    `&mf=off&nx=off&ss=off&s=off&c=off&start=${from}&end=${to}`
  );
}

export function parseHebcal(body: unknown): HolidayItem[] {
  return HebcalBody.parse(body)
    .items.filter((item) => item.category === "holiday" && item.subcat !== "fast")
    .map((item) => ({
      date: item.date.slice(0, 10),
      name: item.title,
      side: "israel" as const,
      country: "Israel",
      source: "Hebcal",
    }));
}

export async function fetchIsraelHolidays(
  http: Http,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<{ items: HolidayItem[]; source: Source }> {
  const result = await http.getJson({ name: "Hebcal (Israeli holidays)", url: hebcalUrl(from, to), ttlMs: WEEK, timeoutMs: 8_000, signal });
  return { items: parseHebcal(result.body), source: result.source };
}
