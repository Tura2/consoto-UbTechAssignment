import type { StepOwner } from "../../../shared/events";
import { AGENT_NAMES, seconds } from "../format";
import { progressSteps, type ProgressState, type ProgressStep } from "../progress";
import type { TurnView } from "../state/turnReducer";
import { Elapsed } from "./Elapsed";
import { StatusIcon, toneClass, type Status } from "./icons";

const STATE_STATUS: Record<ProgressState, Status> = { waiting: "waiting", running: "running", done: "ok", failed: "error" };

// The plan and the policy check are the orchestrator's; each agent step is the agent's; the answer is nobody's.
function ownerOf(key: string): StepOwner | null {
  if (key === "plan" || key === "policy") return "orchestrator";
  return key in AGENT_NAMES ? (key as StepOwner) : null;
}

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
      {steps.map((step) => {
        const owner = ownerOf(step.key);
        return (
          <li key={step.key} className={`progress-step progress-${step.state} ${owner ? toneClass(owner) : ""}`}>
            <StatusIcon status={STATE_STATUS[step.state]} size={14} />
            <span>{step.label}</span>
            <StepTime step={step} />
          </li>
        );
      })}
    </ol>
  );
}
