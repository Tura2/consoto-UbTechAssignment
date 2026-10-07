import { Gauge, History, Plane, SquarePen, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import type { HealthInfo } from "../../../shared/events";
import { getHealth } from "../api";

function healthText(health: HealthInfo): string {
  if (health.keyValid === false) return "OpenRouter key rejected";
  if (health.freeRequestsLeft !== null) return `${health.freeRequestsLeft} free LLM requests left today`;
  return "OpenRouter status unknown";
}

type Props = { finishedTurns: number; onHowItWorks: () => void; onHistory: () => void; onNewChat: () => void };

// finishedTurns changes when a turn ends, which refreshes the free-requests count.
export function Header({ finishedTurns, onHowItWorks, onHistory, onNewChat }: Props) {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    const load = () => getHealth().then(setHealth).catch(() => setHealth(null));
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [finishedTurns]);
  return (
    <header className="header">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          <Plane size={20} />
        </span>
        <div>
          <h1>Consoto Offsite Assistant</h1>
          <p>Plans team offsites from Consoto's data and live public APIs</p>
        </div>
      </div>
      <div className="header-actions">
        {health && (
          <span className={`pill ${health.keyValid === false ? "bad" : ""}`}>
            <Gauge size={13} aria-hidden="true" /> {healthText(health)}
          </span>
        )}
        <button onClick={onHistory}>
          <History size={15} aria-hidden="true" /> History
        </button>
        <button onClick={onHowItWorks}>
          <Workflow size={15} aria-hidden="true" /> How it works
        </button>
        <button className="primary" onClick={onNewChat}>
          <SquarePen size={15} aria-hidden="true" /> New chat
        </button>
      </div>
    </header>
  );
}
