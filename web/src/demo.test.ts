import { describe, expect, it } from "vitest";
import { DEMO_MESSAGES, nextDemoMessage } from "./demo";

const turn = (userMessage: string, status: string) => ({ userMessage, status });

describe("nextDemoMessage", () => {
  it("suggests nothing for an empty chat", () => {
    expect(nextDemoMessage([])).toBeNull();
  });

  it("suggests message 2 after message 1 is done", () => {
    expect(nextDemoMessage([turn(DEMO_MESSAGES[0], "done")])).toBe(DEMO_MESSAGES[1]);
  });

  it("suggests message 1 again when its only turn failed", () => {
    expect(nextDemoMessage([turn(DEMO_MESSAGES[0], "error")])).toBe(DEMO_MESSAGES[0]);
  });

  it("moves on once a retry of message 1 is done", () => {
    const turns = [turn(DEMO_MESSAGES[0], "error"), turn(DEMO_MESSAGES[0], "done")];
    expect(nextDemoMessage(turns)).toBe(DEMO_MESSAGES[1]);
  });

  it("suggests nothing when all three are done", () => {
    expect(nextDemoMessage(DEMO_MESSAGES.map((message) => turn(message, "done")))).toBeNull();
  });
});
