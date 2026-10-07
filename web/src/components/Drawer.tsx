import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEscape } from "../hooks/useEscape";

// A side panel that closes on Escape, the close button, or a click outside it.
export function Drawer({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2 id={id}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
