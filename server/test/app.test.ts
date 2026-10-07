import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { HealthInfo } from "../../shared/events";
import { createApp } from "../src/app";
import type { Llm } from "../src/llm/openrouter";
import { newTrip } from "../src/orchestrator/trip";
import { createStore } from "../src/state/conversations";
import { fakeData } from "./helpers/fake-data";
import { toolCall } from "./helpers/fake-llm";

const HEALTH: HealthInfo = { keyValid: true, freeRequestsLeft: 974, freeRequestsLimit: 1000, isFreeTier: false, models: [], checkedAt: "2026-10-06T08:00:00.000Z" };

// Replies to every planner call with a greeting plan; the first call can be made to hang until aborted.
function greetingLlm(hangFirstCall = false): Llm {
  let calls = 0;
  return {
    complete(request) {
      calls++;
      if (hangFirstCall && calls === 1) {
        return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason)));
      }
      return Promise.resolve({ message: toolCall("submit_plan", { tripUpdate: {}, agents: [], reason: "Greeting." }), model: "fake" });
    },
    async stream(_request, _emit, onText) {
      onText("Hi Maya.");
      return { text: "Hi Maya.", model: "fake" };
    },
  };
}

let server: Server | null = null;
afterEach(() => server?.close());

async function start(llm: Llm, store = createStore(newTrip)): Promise<string> {
  const app = createApp({ store, turnDeps: { llm, data: fakeData(), today: () => "2026-10-06" }, health: async () => HEALTH, webDist: null });
  const listening = app.listen(0);
  server = listening;
  if (!listening.address()) await new Promise((resolve) => listening.once("listening", resolve));
  return `http://localhost:${(listening.address() as AddressInfo).port}`;
}

const post = (base: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

async function readUntil(reader: ReadableStreamDefaultReader<string>, needle: string): Promise<string> {
  let received = "";
  while (!received.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value;
  }
  return received;
}

function firstEvent(raw: string): { conversationId: string } {
  const line = raw.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line!.slice(6));
}

describe("HTTP API", () => {
  it("streams a turn as server-sent events", async () => {
    const base = await start(greetingLlm());
    const response = await post(base, { message: "Hi" });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"turn_start"');
    expect(body).toContain('"type":"answer_delta","text":"Hi Maya."');
    expect(body).toContain('"type":"turn_end","status":"done"');
  });

  it("rejects an empty message", async () => {
    const base = await start(greetingLlm());
    expect((await post(base, { message: "   " })).status).toBe(400);
  });

  it("returns a conversation for reloading, and 404 for an unknown one", async () => {
    const base = await start(greetingLlm());
    const { conversationId } = firstEvent(await (await post(base, { message: "Hi" })).text());
    const conversation = await (await fetch(`${base}/api/conversations/${conversationId}`)).json();
    expect(conversation.turns).toHaveLength(1);
    expect(conversation.turns[0]).toMatchObject({ userMessage: "Hi", answer: "Hi Maya.", status: "done" });
    expect((await fetch(`${base}/api/conversations/nope`)).status).toBe(404);
  });

  it("lists conversations that have turns, newest first", async () => {
    const store = createStore(newTrip);
    store.getOrCreate("empty");
    const base = await start(greetingLlm(), store);
    const { conversationId: older } = firstEvent(await (await post(base, { message: "First" })).text());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { conversationId: newer } = firstEvent(await (await post(base, { message: "Second" })).text());
    const { conversations } = await (await fetch(`${base}/api/conversations`)).json();
    expect(conversations.map((c: { id: string }) => c.id)).toEqual([newer, older]);
    expect(conversations[0]).toMatchObject({ title: "Second", turns: 1 });
  });

  it("serves the agent catalog and the health check", async () => {
    const base = await start(greetingLlm());
    const agents = await (await fetch(`${base}/api/agents`)).json();
    expect(agents.agents).toHaveLength(4);
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual(HEALTH);
  });

  it("a new message stops the running turn", async () => {
    const base = await start(greetingLlm(true));
    const first = await post(base, { message: "First" });
    const reader = first.body!.pipeThrough(new TextDecoderStream()).getReader();
    const { conversationId } = firstEvent(await readUntil(reader, "turn_start"));
    const second = await (await post(base, { conversationId, message: "Second" })).text();
    expect(second).toContain('"status":"done"');
    const rest = await readUntil(reader, "turn_end");
    expect(rest).toContain('"type":"turn_end","status":"stopped"');
  });

  it("a client disconnect stores the turn as stopped", async () => {
    const base = await start(greetingLlm(true));
    const controller = new AbortController();
    const response = await post(base, { message: "Hi" }, controller.signal);
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const { conversationId } = firstEvent(await readUntil(reader, "turn_start"));
    controller.abort();
    let status = "running";
    for (let i = 0; i < 40 && status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await (await fetch(`${base}/api/conversations/${conversationId}`)).json()).turns[0].status;
    }
    expect(status).toBe("stopped");
  });
});
