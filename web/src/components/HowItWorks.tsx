import { useEffect, useState } from "react";
import type { AgentsInfo } from "../../../shared/events";
import { getAgents } from "../api";

export function HowItWorks({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<AgentsInfo | null>(null);
  useEffect(() => {
    getAgents().then(setInfo).catch(() => setInfo(null));
  }, []);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2>How it works</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {!info ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <h3>The orchestrator</h3>
            <p>{info.routing}</p>
            <h3>The agents</h3>
            {info.agents.map((agent) => (
              <section key={agent.id} className="agent-card">
                <h4>{agent.name}</h4>
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
            ))}
            <h3>Code vs model</h3>
            <p>{info.codeVsModel}</p>
          </>
        )}
      </aside>
    </div>
  );
}
