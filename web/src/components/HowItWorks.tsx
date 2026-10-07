import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentsInfo } from "../../../shared/events";
import { getAgents } from "../api";
import { useEscape } from "../hooks/useEscape";
import { OWNER_ICON, toneClass } from "./icons";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  useEffect(() => {
    getAgents()
      .then(setInfo)
      .catch((cause: Error) => setError(cause.message));
  }, []);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="how-title" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2 id="how-title">How it works</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
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
      </aside>
    </div>
  );
}
