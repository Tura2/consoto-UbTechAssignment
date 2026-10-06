import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { StreamEvent } from "../../shared/events";
import { classifyFailure, createLimiter, createLlm, retryAfterMs, type Limiter } from "../src/llm/openrouter";
import { toChatTool } from "../src/llm/schema";

function completion(message: Record<string, unknown>, model = "m1", finish = "stop") {
  return {
    id: "x",
    object: "chat.completion",
    created: 0,
    model,
    choices: [{ index: 0, finish_reason: finish, logprobs: null, message: { role: "assistant", content: null, refusal: null, ...message } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

function apiError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
}

function chunk(content: string, model = "m1") {
  return { id: "c", object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}

const noLimit: Limiter = { acquire: async () => {} };

function setup(responses: Array<(body: Record<string, unknown>) => unknown>) {
  const create = vi.fn(async (body: Record<string, unknown>) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next(body);
  });
  const events: StreamEvent[] = [];
  const llm = createLlm({ client: { create }, models: ["m1", "m2"], limiter: noLimit, sleep: async () => {}, reasoningEffort: "low" });
  return { llm, create, events, emit: (event: StreamEvent) => events.push(event) };
}

const request = { who: "planner" as const, messages: [{ role: "user" as const, content: "hi" }], signal: new AbortController().signal };
const statuses = (events: StreamEvent[]) => events.filter((e) => e.type === "llm_call").map((e) => (e.type === "llm_call" ? e.status : ""));

describe("createLlm.complete", () => {
  it("falls back to the next model on a 429 and reports both attempts", async () => {
    const { llm, create, events, emit } = setup([
      () => { throw apiError(429); },
      (body) => completion({ content: "hello" }, String(body.model)),
    ]);
    const result = await llm.complete(request, emit);
    expect(result.model).toBe("m2");
    expect(result.message.content).toBe("hello");
    expect(statuses(events)).toEqual(["rate_limited", "ok"]);
    expect(create.mock.calls.map((call) => call[0].model)).toEqual(["m1", "m2"]);
    expect(create.mock.calls[0][0].reasoning).toEqual({ effort: "low" });
  });

  it("stops at once on a 401 with a clear message", async () => {
    const { llm, create, emit } = setup([() => { throw apiError(401); }]);
    await expect(llm.complete(request, emit)).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("moves on when a model is gone (404)", async () => {
    const { llm, emit } = setup([() => { throw apiError(404); }, () => completion({ content: "ok" }, "m2")]);
    expect((await llm.complete(request, emit)).model).toBe("m2");
  });

  it("treats an empty reply as a failure", async () => {
    const { llm, events, emit } = setup([() => completion({ content: "" }, "m1", "length"), () => completion({ content: "ok" }, "m2")]);
    await llm.complete(request, emit);
    expect(statuses(events)).toEqual(["empty", "ok"]);
  });

  it("waits and tries the list once more, then gives up", async () => {
    const { llm, create, events, emit } = setup([
      () => { throw apiError(503); },
      () => { throw apiError(503); },
      () => { throw apiError(503); },
      () => { throw apiError(503); },
    ]);
    await expect(llm.complete(request, emit)).rejects.toThrow(/busy or rate limited/);
    expect(create).toHaveBeenCalledTimes(4);
    expect(events).toContainEqual({ type: "llm_wait", who: "planner", waitMs: 2000, reason: "retry_after" });
  });

  it("uses Retry-After for the wait between passes", async () => {
    const { llm, events, emit } = setup([
      () => { throw apiError(429, { "retry-after": "3" }); },
      () => { throw apiError(503); },
      () => completion({ content: "ok" }, "m1"),
    ]);
    await llm.complete(request, emit);
    expect(events).toContainEqual({ type: "llm_wait", who: "planner", waitMs: 3000, reason: "retry_after" });
  });
});

describe("createLlm.stream", () => {
  it("streams text and reports the model that answered", async () => {
    const { llm, emit } = setup([
      () => (async function* () { yield chunk("Hel"); yield chunk("lo"); })(),
    ]);
    const parts: string[] = [];
    const result = await llm.stream({ ...request, who: "answer" }, emit, (text) => parts.push(text));
    expect(parts).toEqual(["Hel", "lo"]);
    expect(result).toEqual({ text: "Hello", model: "m1" });
  });

  it("falls back when the stream fails before any text", async () => {
    const { llm, emit } = setup([
      () => (async function* () { yield { ...chunk(""), error: { message: "Provider disconnected" } }; })(),
      () => (async function* () { yield chunk("Hi", "m2"); })(),
    ]);
    expect((await llm.stream({ ...request, who: "answer" }, emit, () => {})).model).toBe("m2");
  });

  it("fails as interrupted after text arrived, without retrying", async () => {
    const { llm, create, emit } = setup([
      () => (async function* () { yield chunk("Hel"); throw new Error("socket closed"); })(),
    ]);
    const parts: string[] = [];
    await expect(llm.stream({ ...request, who: "answer" }, emit, (t) => parts.push(t))).rejects.toThrow(/interrupted/);
    expect(parts).toEqual(["Hel"]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("helpers", () => {
  it("lets N requests through per minute, then waits for the oldest to expire", async () => {
    let clock = 0;
    const waits: number[] = [];
    const limiter = createLimiter(2, () => clock, async (ms) => { clock += ms; });
    const signal = new AbortController().signal;
    await limiter.acquire(signal, (ms) => waits.push(ms));
    await limiter.acquire(signal, (ms) => waits.push(ms));
    await limiter.acquire(signal, (ms) => waits.push(ms));
    expect(waits).toEqual([60_000]);
  });

  it("classifies failures", () => {
    const live = new AbortController().signal;
    expect(classifyFailure(apiError(429), live)).toBe("rate_limited");
    expect(classifyFailure(apiError(402), live)).toBe("fatal");
    expect(classifyFailure(apiError(500), live)).toBe("next_model");
    expect(classifyFailure(new Error("socket hang up"), live)).toBe("next_model");
    const stopped = new AbortController();
    stopped.abort();
    expect(classifyFailure(apiError(500), stopped.signal)).toBe("abort");
    expect(retryAfterMs(apiError(429, { "retry-after": "30" }))).toBe(10_000);
  });

  it("turns a zod schema into a tool definition", () => {
    const tool = toChatTool("get_city", "Get a city.", z.object({ city: z.string().describe("City name"), days: z.number().optional() }));
    expect(tool.type).toBe("function");
    if (tool.type !== "function") return;
    const parameters = tool.function.parameters as { required?: string[]; properties: Record<string, { description?: string }>; $schema?: string };
    expect(parameters.$schema).toBeUndefined();
    expect(parameters.required).toEqual(["city"]);
    expect(parameters.properties.city.description).toBe("City name");
  });
});
