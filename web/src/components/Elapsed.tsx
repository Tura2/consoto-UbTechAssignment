import { seconds } from "../format";
import { useNow } from "../hooks/useNow";

// A live timer. Only rendered for work that is still running, so finished turns never tick.
export function Elapsed({ since }: { since: number }) {
  const now = useNow(true);
  return <>{seconds(Math.max(0, now - since))}</>;
}
