// The sources behind a turn's answer: unique by name, from tool calls that succeeded.
import type { Source } from "../../shared/domain";
import type { StepView } from "./state/turnReducer";

export function uniqueSources(steps: StepView[]): Source[] {
  const byName = new Map<string, Source>();
  for (const step of steps) {
    if (step.status !== "ok") continue;
    for (const source of step.sources) {
      const known = byName.get(source.name);
      if (!known || (!known.url.startsWith("http") && source.url.startsWith("http"))) byName.set(source.name, source);
    }
  }
  return [...byName.values()];
}
