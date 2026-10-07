import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newTrip } from "../src/orchestrator/trip";
import { runTurn } from "../src/orchestrator/turn";
import { createStore } from "../src/state/conversations";
import { fakeData } from "./helpers/fake-data";
import { scriptedLlm, toolCall } from "./helpers/fake-llm";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "consoto-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const greeting = () => toolCall("submit_plan", { tripUpdate: { team: "platform", days: 3 }, agents: [], reason: "Greeting." });

async function runGreeting(store: ReturnType<typeof createStore>, id: string | null, message: string) {
  const { llm } = scriptedLlm({ planner: [greeting()] });
  const conversation = store.getOrCreate(id);
  await runTurn(conversation, message, { llm, data: fakeData(), today: () => "2026-10-06" }, () => {}, new AbortController().signal);
  store.save(conversation);
  return conversation;
}

describe("saved conversations", () => {
  it("saves after a turn, reloads in a new store, and continues the conversation", async () => {
    const first = await runGreeting(createStore(newTrip, { dir }), "demo-1", "Hi");
    const saved = JSON.parse(readFileSync(path.join(dir, "demo-1.json"), "utf8"));
    expect(Object.keys(saved).sort()).toEqual(["findings", "id", "trip", "turns", "updatedAt"]);

    const reloaded = createStore(newTrip, { dir });
    const loaded = reloaded.get("demo-1")!;
    expect(loaded.trip).toEqual(first.trip);
    expect(loaded.turns).toEqual(first.turns);
    expect(loaded.active).toBeNull();
    const continued = await runGreeting(reloaded, "demo-1", "Hi again");
    expect(continued.turns).toHaveLength(2);
  });

  it("never lets a bad id reach the file system", async () => {
    const store = createStore(newTrip, { dir });
    const badIds = ["../escape", "a/b", "a\\b", "", "x".repeat(65), "name.json"];
    for (const bad of badIds) {
      const conversation = await runGreeting(store, bad, "Hi");
      expect(conversation.id).toMatch(/^[A-Za-z0-9-]{1,64}$/);
      expect(conversation.id).not.toBe(bad);
    }
    expect(readdirSync(dir)).toHaveLength(badIds.length);
    expect(existsSync(path.join(dir, "..", "escape.json"))).toBe(false);
  });

  it("skips a corrupt file and loads the others", async () => {
    await runGreeting(createStore(newTrip, { dir }), "good", "Hi");
    writeFileSync(path.join(dir, "broken.json"), "{ not json");
    const store = createStore(newTrip, { dir });
    expect(store.get("good")).not.toBeNull();
    expect(store.get("broken")).toBeNull();
  });

  it("lists only conversations with turns, newest first, with a shortened title", async () => {
    const store = createStore(newTrip, { dir });
    await runGreeting(store, "older", "First question");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runGreeting(store, "newer", "y".repeat(100));
    store.getOrCreate("empty");
    const list = store.list();
    expect(list.map((item) => item.id)).toEqual(["newer", "older"]);
    expect(list[0]!.title).toBe(`${"y".repeat(80)}...`);
    expect(list[1]).toMatchObject({ title: "First question", turns: 1 });
    expect(new Date(list[0]!.updatedAt).toISOString()).toBe(list[0]!.updatedAt);
  });

  it("works without a directory", async () => {
    const store = createStore(newTrip);
    await runGreeting(store, "mem", "Hi");
    expect(store.list()).toHaveLength(1);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
