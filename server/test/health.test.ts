import { describe, expect, it, vi } from "vitest";
import { createHealthCheck, describeHealth } from "../src/health";

const KEY = { data: { is_free_tier: false, free_model_daily_requests: { used: 26, limit: 1000, remaining: 974 } } };
const MODELS = {
  data: [
    { id: "google/gemma-4-31b-it:free", supported_parameters: ["tools", "tool_choice"] },
    { id: "some/text-only:free", supported_parameters: ["temperature"] },
  ],
};

function fetchReturning(key: { status: number; body: unknown }, models: unknown) {
  return vi.fn(async (url: string) =>
    url.endsWith("/key")
      ? new Response(JSON.stringify(key.body), { status: key.status })
      : new Response(JSON.stringify(models), { status: 200 }),
  );
}

describe("createHealthCheck", () => {
  it("reports the free requests left and which models support tools", async () => {
    const check = createHealthCheck("key", ["google/gemma-4-31b-it:free", "some/text-only:free", "gone/model:free"], fetchReturning({ status: 200, body: KEY }, MODELS) as unknown as typeof fetch);
    const info = await check();
    expect(info).toMatchObject({ keyValid: true, freeRequestsLeft: 974, freeRequestsLimit: 1000, isFreeTier: false });
    expect(info.models).toEqual([
      { id: "google/gemma-4-31b-it:free", available: true },
      { id: "some/text-only:free", available: false },
      { id: "gone/model:free", available: false },
    ]);
  });

  it("flags a rejected key and caches for a minute", async () => {
    let clock = 0;
    const fetchImpl = fetchReturning({ status: 401, body: { error: { message: "No auth", code: 401 } } }, MODELS);
    const check = createHealthCheck("bad", ["google/gemma-4-31b-it:free"], fetchImpl as unknown as typeof fetch, () => clock);
    expect((await check()).keyValid).toBe(false);
    clock = 30_000;
    await check();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // key + models, once
    expect(describeHealth(await check())[0]).toMatch(/rejected the API key/);
  });

  it("returns unknowns when OpenRouter cannot be reached", async () => {
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const info = await createHealthCheck("key", ["m:free"], offline as unknown as typeof fetch)();
    expect(info).toMatchObject({ keyValid: null, freeRequestsLeft: null, models: [{ id: "m:free", available: null }] });
  });
});
