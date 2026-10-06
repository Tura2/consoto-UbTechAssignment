import type { StreamEvent } from "../../shared/events";

// Splits a server-sent-events buffer into complete events and the unfinished tail.
// Comment lines (": ping") carry no data and are skipped.
export function parseSse(buffer: string): { events: StreamEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: StreamEvent[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("\n");
    if (data) events.push(JSON.parse(data) as StreamEvent);
  }
  return { events, rest };
}
