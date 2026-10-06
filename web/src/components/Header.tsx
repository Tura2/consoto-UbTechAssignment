import { useEffect, useState } from "react";
import type { HealthInfo } from "../../../shared/events";
import { getHealth } from "../api";

function healthText(health: HealthInfo): string {
  if (health.keyValid === false) return "OpenRouter key rejected";
  if (health.freeRequestsLeft !== null) return `${health.freeRequestsLeft} free LLM requests left today`;
  return "OpenRouter status unknown";
}

export function Header({ onHowItWorks, onNewChat }: { onHowItWorks: () => void; onNewChat: () => void }) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    const load = () => getHealth().then(setHealth).catch(() => setHealth(null));
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header className="header">
      <div className="brand">
        <span className="logo">C</span>
        <div>
          <h1>Consoto Offsite Assistant</h1>
          <p>Plans team offsites from Consoto's data and live public APIs</p>
        </div>
      </div>
      <div className="header-actions">
        {health && <span className={`pill ${health.keyValid === false ? "bad" : ""}`}>{healthText(health)}</span>}
        <button onClick={onHowItWorks}>How it works</button>
        <button onClick={onNewChat}>New chat</button>
      </div>
    </header>
  );
}
