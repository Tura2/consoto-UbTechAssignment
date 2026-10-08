import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../../shared/events";
import { AGENTS, agentsInfo } from "../src/agents/registry";
import { runAgent } from "../src/agents/runner";
import type { Llm } from "../src/llm/openrouter";
import { MARCH, makeCtx } from "./helpers/ctx";
import { scriptedLlm, text, toolCall, toolCalls } from "./helpers/fake-llm";

function collect() {
  const events: StreamEvent[] = [];
  return { events, emit: (event: StreamEvent) => events.push(event) };
}

describe("runAgent", () => {
  it("runs the tools the model asks for and keeps the raw results", async () => {
    const { llm } = scriptedLlm({
      budget_policy: [toolCall("budget_estimate_cost", { cities: ["Lisbon"], days: 3, team: "platform" }), text("Lisbon is 3,036 ILS per person.")],
    });
    const { events, emit } = collect();
    const result = await runAgent({ def: AGENTS.budget_policy, task: "Cost of Lisbon", ctx: makeCtx(), llm, emit });
    expect(result.status).toBe("ok");
    expect(result.summary).toBe("Lisbon is 3,036 ILS per person.");
    expect(result.toolRuns).toHaveLength(1);
    expect(result.toolRuns[0].result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["agent_start", "llm_call", "tool_start", "tool_end", "llm_call", "agent_end"]);
  });

  it("runs several tool calls from one round", async () => {
    const { llm } = scriptedLlm({
      weather_calendar: [
        toolCalls([
          { name: "calendar_find_clean_windows", args: { cities: ["Lisbon"], ...MARCH, days: 3 } },
          { name: "weather_get_outlook", args: { cities: ["Lisbon"], ...MARCH } },
        ]),
        text("Done."),
      ],
    });
    const result = await runAgent({ def: AGENTS.weather_calendar, task: "Lisbon weather", ctx: makeCtx(), llm, emit: () => {} });
    expect(result.toolRuns.map((run) => run.tool)).toEqual(["calendar_find_clean_windows", "weather_get_outlook"]);
  });

  it("tells the model about a tool it does not have", async () => {
    const { llm } = scriptedLlm({ venues: [toolCall("book_restaurant", {}), text("I cannot book.")] });
    const result = await runAgent({ def: AGENTS.venues, task: "Book", ctx: makeCtx(), llm, emit: () => {} });
    expect(result.toolRuns[0].result).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
  });

  it("stops after the round limit", async () => {
    const call = toolCall("places_find_for_team", { city: "Lisbon", team: "platform" });
    const { llm } = scriptedLlm({ venues: [call, call] });
    const result = await runAgent({ def: AGENTS.venues, task: "Find", ctx: makeCtx(), llm, emit: () => {} });
    expect(result.toolRuns).toHaveLength(2);
    expect(result.summary).toBe("Stopped after 2 tool rounds.");
  });

  it("reports a timeout when the turn's agent budget runs out", async () => {
    const waitForAbort: Llm = {
      complete: (request) => new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason))),
      stream: async () => "",
    };
    const { events, emit } = collect();
    const result = await runAgent({ def: AGENTS.venues, task: "Find", ctx: makeCtx({ signal: AbortSignal.timeout(20) }), llm: waitForAbort, emit });
    expect(result.status).toBe("timeout");
    expect(events.at(-1)).toMatchObject({ type: "agent_end", status: "timeout" });
  });

  it("rethrows when the user stops the turn", async () => {
    const controller = new AbortController();
    const stopNow: Llm = {
      complete: async () => {
        controller.abort();
        throw new Error("aborted");
      },
      stream: async () => "",
    };
    await expect(runAgent({ def: AGENTS.venues, task: "Find", ctx: makeCtx({ signal: controller.signal }), llm: stopNow, emit: () => {} })).rejects.toThrow();
  });

  it("reports an LLM failure as an agent error", async () => {
    const busy: Llm = { complete: async () => { throw new Error("All configured models are busy"); }, stream: async () => "" };
    const result = await runAgent({ def: AGENTS.venues, task: "Find", ctx: makeCtx(), llm: busy, emit: () => {} });
    expect(result).toMatchObject({ status: "error", summary: "All configured models are busy" });
  });
});

describe("agentsInfo", () => {
  it("describes the four agents and their tools", () => {
    const info = agentsInfo();
    expect(info.agents.map((agent) => agent.id)).toEqual(["budget_policy", "weather_calendar", "venues", "itinerary"]);
    expect(info.agents[0].tools.map((tool) => tool.name)).toEqual(["budget_estimate_cost", "budget_get_team"]);
  });
});
