// OpenStreetMap places through the public Overpass server. Its policy forbids parallel queries,
// and it is often overloaded, so: one query at a time, no retries inside a turn, cache for a week.
import { z } from "zod";
import type { Source } from "../../../shared/domain";
import type { Http } from "./http";

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const WEEK = 7 * 86_400_000;

const OverpassBody = z.object({ elements: z.array(z.unknown()) });

export async function fetchOverpass(
  http: Http,
  query: string,
  signal?: AbortSignal,
): Promise<{ elements: unknown[]; source: Source }> {
  const result = await http.getJson({
    name: "OpenStreetMap (Overpass)",
    url: OVERPASS_URL,
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    ttlMs: WEEK,
    timeoutMs: 30_000,
    retries: 0,
    maxConcurrency: 1,
    signal,
  });
  return { elements: OverpassBody.parse(result.body).elements, source: result.source };
}
