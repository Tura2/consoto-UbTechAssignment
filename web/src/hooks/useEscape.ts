// Calls onEscape when the Escape key is pressed. Used by the dialogs.
import { useEffect } from "react";

export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
