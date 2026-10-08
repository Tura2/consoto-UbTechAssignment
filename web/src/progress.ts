// The compact progress strip of a turn: Plan, each agent, Policy check (when it ran), Answer.
import type { TurnView } from "./state/turnReducer";

export type ProgressState = "waiting" | "running" | "done" | "failed";
export type ProgressStep = { key: string; label: string; state: ProgressState; ms: number | null; startedAt: number | null };

const AGENT_STATE = { running: "running", ok: "done", error: "failed", timeout: "failed" } as const;

// label turns an agent id into its display name.
export function progressSteps(turn: TurnView, label: (agent: string) => string): ProgressStep[] {
  const finished = turn.status !== "running";
  const steps: ProgressStep[] = [
    { key: "plan", label: "Plan", state: turn.plan ? "done" : finished ? "failed" : "running", ms: turn.plan?.ms ?? null, startedAt: turn.startedAt },
  ];
  for (const planned of turn.plan?.agents ?? []) {
    const view = turn.agents.find((agent) => agent.agent === planned);
    steps.push({
      key: planned,
      label: label(planned),
      state: view ? AGENT_STATE[view.status] : finished ? "failed" : "waiting",
      ms: view?.ms ?? null,
      startedAt: view?.startedAt ?? null,
    });
  }
  const inFlight = steps.some((step) => step.state === "running" || step.state === "waiting");
  const policy = turn.steps.find((step) => step.owner === "orchestrator" && step.tool === "policy_check");
  if (policy) {
    const state: ProgressState = policy.status === "running" ? "running" : policy.status === "ok" ? "done" : "failed";
    steps.push({ key: "policy", label: "Policy check", state, ms: policy.ms, startedAt: null });
  }
  const policyRunning = policy?.status === "running";
  const answerState: ProgressState = turn.status === "done" ? "done" : finished ? "failed" : inFlight || policyRunning ? "waiting" : "running";
  steps.push({ key: "answer", label: "Answer", state: answerState, ms: null, startedAt: null });
  return steps;
}
