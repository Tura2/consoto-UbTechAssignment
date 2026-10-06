import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StreamEvent } from "../../shared/events";
import { defineTool, ok, runTool, runToolWithEvents } from "../src/tools/types";
import { fakeSource } from "./helpers/fake-data";
import { makeCtx } from "./helpers/ctx";

const echo = defineTool({
  name: "echo",
  description: "Echo the text.",
  input: z.object({ text: z.string() }),
  async execute({ text }) {
    return ok(`Echo: ${text}`, { text }, [{ ...fakeSource("Echo API"), cached: true }]);
  },
});

const broken = defineTool({
  name: "broken",
  description: "Always fails.",
  input: z.object({}),
  async execute() {
    throw new Error("HTTP 504");
  },
});

describe("runTool", () => {
  it("runs a tool with valid input", async () => {
    const result = await runTool(echo, { text: "hi" }, makeCtx());
    expect(result).toMatchObject({ ok: true, summary: "Echo: hi", data: { text: "hi" } });
  });

  it("turns invalid input into an error the model can fix", async () => {
    const result = await runTool(echo, { text: 5 }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_input");
      expect(result.error.message).toContain("text");
    }
  });

  it("turns a data failure into source_unavailable", async () => {
    const result = await runTool(broken, {}, makeCtx());
    expect(result).toMatchObject({ ok: false, error: { code: "source_unavailable" } });
  });

  it("rethrows when the user stopped the turn", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runTool(broken, {}, makeCtx({ signal: controller.signal }))).rejects.toThrow("HTTP 504");
  });

  it("emits start and end events", async () => {
    const events: StreamEvent[] = [];
    await runToolWithEvents({ tool: echo, input: { text: "hi" }, ctx: makeCtx(), owner: "budget_policy", emit: (e) => events.push(e) });
    expect(events.map((e) => e.type)).toEqual(["tool_start", "tool_end"]);
    expect(events[1]).toMatchObject({ ok: true, summary: "Echo: hi", cached: true });
  });
});
