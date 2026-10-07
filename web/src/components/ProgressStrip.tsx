import { AGENT_NAMES, seconds } from "../format";
import { progressSteps, type ProgressState, type ProgressStep } from "../progress";
import type { TurnView } from "../state/turnReducer";
import { Elapsed } from "./Elapsed";

const STATE_TEXT: Record<ProgressState, string> = { waiting: "waiting", running: "running", done: "done", failed: "failed" };

function StepTime({ step }: { step: ProgressStep }) {
  if (step.ms !== null) return <span className="muted">{seconds(step.ms)}</span>;
  if (step.state === "running" && step.startedAt !== null) return <span className="muted"><Elapsed since={step.startedAt} /></span>;
  return null;
}

// Plan, each agent, Policy check (when it ran), Answer: one pill per step with its state and time.
export function ProgressStrip({ turn }: { turn: TurnView }) {
  const steps = progressSteps(turn, (agent) => AGENT_NAMES[agent as keyof typeof AGENT_NAMES]);
  return (
    <ol className="progress" aria-label="Progress">
      {steps.map((step) => (
        <li key={step.key} className={`progress-step progress-${step.state}`}>
          <span className="progress-dot" aria-hidden="true" />
          <span>{step.label}</span>
          <span className="sr-only">{STATE_TEXT[step.state]}</span>
          <StepTime step={step} />
        </li>
      ))}
    </ol>
  );
}
