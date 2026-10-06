import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { HttpError, createHttp } from "../src/clients/http";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function setup(responses: Array<() => Response>) {
  const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  });
  let clock = 1_000_000;
  const sleep = vi.fn(async (_ms: number) => {});
  const http = createHttp({
    cacheDir: mkdtempSync(path.join(os.tmpdir(), "http-test-")),
    userAgent: "test-agent",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => clock,
    sleep,
  });
  return { http, fetchImpl, sleep, advance: (ms: number) => (clock += ms) };
}

const spec = { name: "Test API", url: "https://api.test/data", ttlMs: 60_000, timeoutMs: 1_000 };

describe("createHttp", () => {
  it("fetches, caches and serves from cache within the TTL", async () => {
    const { http, fetchImpl } = setup([() => json({ a: 1 })]);
    const first = await http.getJson(spec);
    const second = await http.getJson(spec);
    expect(first.body).toEqual({ a: 1 });
    expect(first.source).toMatchObject({ name: "Test API", url: spec.url, cached: false });
    expect(second.source.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("sends the User-Agent header", async () => {
    const { http, fetchImpl } = setup([() => json({})]);
    await http.getJson(spec);
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("test-agent");
  });

  it("refetches after the TTL", async () => {
    const { http, fetchImpl, advance } = setup([() => json({ a: 1 }), () => json({ a: 2 })]);
    await http.getJson(spec);
    advance(60_001);
    expect((await http.getJson(spec)).body).toEqual({ a: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 503 and then succeeds", async () => {
    const { http, fetchImpl, sleep } = setup([() => json({}, 503), () => json({ ok: true })]);
    expect((await http.getJson(spec)).body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500, undefined);
  });

  it("waits for Retry-After on a 429", async () => {
    const { http, sleep } = setup([() => json({}, 429, { "Retry-After": "2" }), () => json({ ok: true })]);
    await http.getJson(spec);
    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it("does not retry a 404", async () => {
    const { http, fetchImpl } = setup([() => json({ title: "not found" }, 404)]);
    await expect(http.getJson(spec)).rejects.toMatchObject({ status: 404, retryable: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves the expired cache entry as stale when the API fails", async () => {
    const { http, advance } = setup([() => json({ a: 1 }), () => json({}, 503), () => json({}, 503), () => json({}, 503)]);
    await http.getJson(spec);
    advance(60_001);
    const result = await http.getJson(spec);
    expect(result).toMatchObject({ body: { a: 1 }, stale: true });
    expect(result.source.cached).toBe(true);
  });

  it("shares one fetch between identical requests in flight", async () => {
    const { http, fetchImpl } = setup([() => json({ a: 1 })]);
    const [a, b] = await Promise.all([http.getJson(spec), http.getJson(spec)]);
    expect(a.body).toEqual(b.body);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-JSON 200 without retrying", async () => {
    const { http, fetchImpl } = setup([() => new Response("<html>busy</html>", { status: 200 })]);
    await expect(http.getJson(spec)).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats an HTML 504 as retryable and gives up after the retries", async () => {
    const { http, fetchImpl } = setup([
      () => new Response("<html>504</html>", { status: 504 }),
      () => new Response("<html>504</html>", { status: 504 }),
    ]);
    await expect(http.getJson({ ...spec, retries: 1 })).rejects.toMatchObject({ status: 504, retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops at once when the caller aborts", async () => {
    const { http, fetchImpl } = setup([() => json({ a: 1 })]);
    const controller = new AbortController();
    controller.abort();
    await expect(http.getJson({ ...spec, signal: controller.signal })).rejects.toBeDefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still returns fresh data when the cache cannot be written", async () => {
    // Create a regular file, then try to use a path under it as cacheDir (will fail to create).
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "http-test-"));
    const blockingFile = path.join(tempDir, "blocked");
    writeFileSync(blockingFile, "");
    const invalidCacheDir = path.join(blockingFile, "cache");

    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => json({ a: 1 }));
    let clock = 1_000_000;
    const sleep = vi.fn(async (_ms: number) => {});
    const http = createHttp({
      cacheDir: invalidCacheDir,
      userAgent: "test-agent",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
      sleep,
    });

    const result = await http.getJson(spec);
    expect(result.body).toEqual({ a: 1 });
    expect(result.source.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
