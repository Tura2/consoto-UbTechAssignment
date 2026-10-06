import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

describe("parseSse", () => {
  it("returns complete events and keeps the unfinished tail", () => {
    const buffer = 'data: {"type":"answer_delta","text":"Hi"}\n\n: ping\n\ndata: {"type":"answer_del';
    const { events, rest } = parseSse(buffer);
    expect(events).toEqual([{ type: "answer_delta", text: "Hi" }]);
    expect(rest).toBe('data: {"type":"answer_del');
  });

  it("joins chunks that arrive in pieces", () => {
    const first = parseSse('data: {"type":"answer_delta",');
    const second = parseSse(`${first.rest}"text":"there"}\n\n`);
    expect(first.events).toEqual([]);
    expect(second.events).toEqual([{ type: "answer_delta", text: "there" }]);
  });
});
