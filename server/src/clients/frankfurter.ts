// EUR to ILS from Frankfurter v2, pinned to the ECB (policy rule 6: "the latest ECB rate").
import { z } from "zod";
import type { Source } from "../../../shared/domain";
import type { Http } from "./http";

export const ECB_RATE_URL = "https://api.frankfurter.dev/v2/rates?base=EUR&quotes=ILS&providers=ECB";
const HOUR = 3_600_000;

const RateRows = z
  .array(z.object({ date: z.string(), base: z.literal("EUR"), quote: z.literal("ILS"), rate: z.number().positive() }))
  .min(1);

export type Rate = { value: number; date: string };

export function parseEcbRate(body: unknown): Rate {
  const row = RateRows.parse(body)[0];
  return { value: row.rate, date: row.date };
}

export async function fetchEcbRate(http: Http, signal?: AbortSignal): Promise<{ rate: Rate; source: Source }> {
  const result = await http.getJson({ name: "Frankfurter (ECB rate)", url: ECB_RATE_URL, ttlMs: HOUR, timeoutMs: 8_000, signal });
  return { rate: parseEcbRate(result.body), source: result.source };
}
