import { MessageSquare, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConversationSummary } from "../../../shared/events";
import { listConversations } from "../api";
import { dateTime } from "../format";
import { useEscape } from "../hooks/useEscape";

type Props = { currentId: string | null; onOpen: (id: string) => Promise<void>; onClose: () => void };

export function HistoryPanel({ currentId, onOpen, onClose }: Props) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  useEffect(() => {
    listConversations()
      .then(setItems)
      .catch((cause: Error) => setError(cause.message));
  }, []);

  async function open(id: string) {
    try {
      await onOpen(id);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2 id="history-title">History</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {error && <p className="notice bad">{error}</p>}
        {!error && !items && <p className="muted">Loading...</p>}
        {items && items.length === 0 && <p className="muted">No saved conversations yet. Every conversation is saved here after its first answer.</p>}
        {items && items.length > 0 && (
          <ul className="history-list">
            {items.map((item) => (
              <li key={item.id}>
                <button className="history-row" onClick={() => open(item.id)} aria-current={item.id === currentId ? "true" : undefined}>
                  <MessageSquare size={16} className="history-icon" aria-hidden="true" />
                  <strong>{item.title}</strong>
                  <span className="muted">
                    {dateTime(item.updatedAt)}, {item.turns} {item.turns === 1 ? "turn" : "turns"}
                  </span>
                  {item.id === currentId && <span className="badge current">Current</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
