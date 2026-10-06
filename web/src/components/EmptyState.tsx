import { DEMO_MESSAGES } from "../demo";

export function EmptyState({ onPick }: { onPick: (message: string) => void }) {
  return (
    <div className="empty">
      <h2>Plan your next offsite</h2>
      <p className="muted">
        Ask in plain words. Every answer shows which agent worked, which tools it called and what came back, with sources.
      </p>
      <div className="suggestions">
        {DEMO_MESSAGES.map((message, index) => (
          <button key={message} onClick={() => onPick(message)} disabled={index > 0}>
            <span className="muted">Message {index + 1}</span>
            {message}
          </button>
        ))}
      </div>
    </div>
  );
}
