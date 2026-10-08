import type { AgentId } from "../../../shared/domain";
import { AGENT_NAMES } from "../format";
import { OWNER_ICON, ownerName, toneClass } from "./icons";

const AGENTS = Object.keys(AGENT_NAMES) as AgentId[];

export function EmptyState() {
  return (
    <div className="empty">
      <h2>Plan your next offsite</h2>
      <p className="muted">
        Ask in plain words. Every answer shows which agent worked, which tools it called and what came back, with sources.
      </p>
      <ul className="agent-row" aria-label="The agents">
        {AGENTS.map((agent) => {
          const Icon = OWNER_ICON[agent];
          return (
            <li key={agent} className={toneClass(agent)}>
              <Icon size={18} className="tone-icon" aria-hidden="true" />
              {ownerName(agent)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
