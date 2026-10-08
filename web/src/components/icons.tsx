// Who did the work and how it went, shown the same way everywhere: each agent (and the orchestrator's own code)
// has an icon and a colour, and every status has an icon. Colour means owner or status, never decoration.
import {
  CalendarDays,
  Circle,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Route,
  TimerOff,
  UtensilsCrossed,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { StepOwner } from "../../../shared/events";
import { AGENT_NAMES } from "../format";

export const OWNER_ICON: Record<StepOwner, LucideIcon> = {
  budget_policy: Wallet,
  weather_calendar: CalendarDays,
  venues: UtensilsCrossed,
  itinerary: Route,
  orchestrator: Workflow,
};

export const ownerName = (owner: StepOwner) => (owner === "orchestrator" ? "Orchestrator" : AGENT_NAMES[owner]);
export const toneClass = (owner: StepOwner) => `tone-${owner}`;

// A small label naming the agent, in its colour.
export function OwnerTag({ owner }: { owner: StepOwner }) {
  const Icon = OWNER_ICON[owner];
  return (
    <span className={`owner-tag ${toneClass(owner)}`}>
      <Icon size={14} aria-hidden="true" />
      {ownerName(owner)}
    </span>
  );
}

export type Status = "waiting" | "running" | "ok" | "error" | "timeout";

const STATUS_ICON: Record<Status, LucideIcon> = { waiting: Circle, running: LoaderCircle, ok: CircleCheck, error: CircleX, timeout: TimerOff };

export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  const Icon = STATUS_ICON[status];
  return <Icon size={size} className={`status-icon status-${status}`} aria-label={status} role="img" />;
}
