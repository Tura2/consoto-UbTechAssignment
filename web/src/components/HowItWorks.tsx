import { useEffect, useState } from "react";
import type { AgentsInfo } from "../../../shared/events";
import { getAgents } from "../api";
import { Drawer } from "./Drawer";
import { OWNER_ICON, toneClass } from "./icons";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getAgents()
      .then(setInfo)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return (
    <Drawer id="how-title" title="How it works" onClose={onClose}>
      {error && <p className="notice bad">{error}</p>}
      {!error && !info && <p className="muted">Loading...</p>}
      {info && (
        <>
          <h3>The orchestrator</h3>
          <p>{info.routing}</p>
          <h3>The agents</h3>
          {info.agents.map((agent) => {
            const Icon = OWNER_ICON[agent.id];
            return (
              <section key={agent.id} className={`agent-card ${toneClass(agent.id)}`}>
                <h4>
                  <Icon size={16} className="tone-icon" aria-hidden="true" /> {agent.name}
                </h4>
                <p>{agent.purpose}</p>
                <ul>
                  {agent.tools.map((tool) => (
                    <li key={tool.name}>
                      <code>{tool.name}</code>
                      <span className="muted"> {tool.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <h3>Code vs model</h3>
          <p>{info.codeVsModel}</p>
        </>
      )}
    </Drawer>
  );
}
