// One HTTP helper for every public API: disk cache, in-flight dedupe, per-host concurrency,
// retries only where a retry can help, and stale data (labeled) when the API is down.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Source } from "../../../shared/domain";
import { sleepMs } from "../lib/sleep";

export type RequestSpec = {
  name: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  ttlMs: number;
  timeoutMs: number;
  retries?: number;
  maxConcurrency?: number;
  signal?: AbortSignal;
};

export type HttpResult = { body: unknown; source: Source; stale: boolean };

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type Http = { getJson(spec: RequestSpec): Promise<HttpResult> };

type CacheEntry = { key: string; fetchedAt: number; body: unknown };

type Options = {
  cacheDir: string | null;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  maxRetryWaitMs?: number;
};

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active++;
    else await new Promise<void>((resolve) => this.queue.push(resolve)); // the releasing task hands over its slot
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export function createHttp(options: Options): Http {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepMs;
  const maxRetryWaitMs = options.maxRetryWaitMs ?? 10_000;
  const inFlight = new Map<string, Promise<HttpResult>>();
  const hosts = new Map<string, Semaphore>();

  const sourceOf = (spec: RequestSpec, fetchedAt: number, cached: boolean): Source => ({
    name: spec.name,
    url: spec.url,
    fetchedAt: new Date(fetchedAt).toISOString(),
    cached,
  });

  function cacheFile(key: string): string | null {
    if (!options.cacheDir) return null;
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    return path.join(options.cacheDir, `${hash}.json`);
  }

  async function readCache(key: string): Promise<CacheEntry | null> {
    const file = cacheFile(key);
    if (!file) return null;
    try {
      const entry = JSON.parse(await readFile(file, "utf8")) as CacheEntry;
      return entry.key === key ? entry : null;
    } catch {
      return null;
    }
  }

  async function writeCache(entry: CacheEntry): Promise<void> {
    const file = cacheFile(entry.key);
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(entry));
  }

  async function fetchOnce(spec: RequestSpec): Promise<unknown> {
    const timeout = AbortSignal.timeout(spec.timeoutMs);
    const signal = spec.signal ? AbortSignal.any([spec.signal, timeout]) : timeout;
    const headers: Record<string, string> = { "User-Agent": options.userAgent, Accept: "application/json" };
    if (spec.body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let response: Response;
    try {
      response = await fetchImpl(spec.url, { method: spec.method ?? "GET", body: spec.body, headers, signal });
    } catch (error) {
      if (spec.signal?.aborted) throw error;
      const reason = timeout.aborted ? `no answer within ${spec.timeoutMs} ms` : "network error";
      throw new HttpError(`${spec.name}: ${reason}`, null, true);
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new HttpError(
        `${spec.name}: HTTP ${response.status}`,
        response.status,
        retryable,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(`${spec.name}: the response was not JSON`, response.status, false);
    }
  }

  async function fetchWithRetries(spec: RequestSpec, key: string, cached: CacheEntry | null): Promise<HttpResult> {
    const retries = spec.retries ?? 2;
    const host = new URL(spec.url).host;
    const slots = hosts.get(host) ?? new Semaphore(spec.maxConcurrency ?? 4);
    hosts.set(host, slots);
    let lastError = new HttpError(`${spec.name}: no attempt made`, null, false);
    let waited = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      spec.signal?.throwIfAborted();
      try {
        const body = await slots.run(() => fetchOnce(spec));
        const fetchedAt = now();
        await writeCache({ key, fetchedAt, body });
        return { body, source: sourceOf(spec, fetchedAt, false), stale: false };
      } catch (error) {
        if (spec.signal?.aborted) throw error;
        lastError = error instanceof HttpError ? error : new HttpError(`${spec.name}: ${(error as Error).message}`, null, true);
        if (!lastError.retryable || attempt === retries) break;
        const wait = lastError.retryAfterMs ?? 500 * 3 ** attempt;
        if (waited + wait > maxRetryWaitMs) break;
        waited += wait;
        await sleep(wait, spec.signal);
      }
    }
    if (cached) return { body: cached.body, source: sourceOf(spec, cached.fetchedAt, true), stale: true };
    throw lastError;
  }

  async function load(spec: RequestSpec, key: string): Promise<HttpResult> {
    const cached = await readCache(key);
    if (cached && now() - cached.fetchedAt < spec.ttlMs) {
      return { body: cached.body, source: sourceOf(spec, cached.fetchedAt, true), stale: false };
    }
    return fetchWithRetries(spec, key, cached);
  }

  return {
    getJson(spec) {
      if (spec.signal?.aborted) return Promise.reject(spec.signal.reason);
      const key = `${spec.method ?? "GET"} ${spec.url} ${spec.body ?? ""}`;
      // Registered synchronously, so a second identical call always joins the first one.
      const running = inFlight.get(key);
      if (running) return running;
      const promise = load(spec, key).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}
