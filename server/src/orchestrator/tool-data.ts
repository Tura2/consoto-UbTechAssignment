import type { AgentResult } from "../agents/runner";

// The data of the last successful run of `tool` across these agent results.
export function lastToolData<T>(results: AgentResult[], tool: string): T | null {
  for (const result of [...results].reverse()) {
    for (const run of [...result.toolRuns].reverse()) {
      if (run.tool === tool && run.result.ok) return run.result.data as T;
    }
  }
  return null;
}
