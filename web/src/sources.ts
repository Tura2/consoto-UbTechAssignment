// The sources behind a turn's answer, one entry per provider, from tool calls that succeeded.
// Source names read "Provider (detail)", for example "Nager.Date (Portugal public holidays)".
import type { StepView } from "./state/turnReducer";

export type SourceGroup = { provider: string; url: string | null; details: string[] };

export function sourceGroups(steps: StepView[]): SourceGroup[] {
  const byProvider = new Map<string, SourceGroup>();
  for (const step of steps) {
    if (step.status !== "ok") continue;
    for (const source of step.sources) {
      const [provider, rest] = source.name.split(" (");
      const group = byProvider.get(provider) ?? { provider, url: null, details: [] };
      if (!group.url && source.url.startsWith("http")) group.url = source.url;
      const detail = rest?.replace(/\)$/, "");
      if (detail && !group.details.includes(detail)) group.details.push(detail);
      byProvider.set(provider, group);
    }
  }
  return [...byProvider.values()];
}
