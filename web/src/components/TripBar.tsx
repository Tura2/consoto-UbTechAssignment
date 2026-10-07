import { CalendarDays, CalendarRange, MapPin, Users, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Trip } from "../../../shared/domain";
import { changedFields, tripSummary, type TripField } from "../trip";

const FLASH_MS = 2500;

// The current trip, kept visible above the chat. A value that changed between turns flashes briefly.
export function TripBar({ trip }: { trip: Trip | null }) {
  const summary = trip ? tripSummary(trip) : null;
  const previous = useRef(summary);
  const [flashing, setFlashing] = useState<TripField[]>([]);
  const summaryKey = JSON.stringify(summary);

  useEffect(() => {
    if (!summary) return;
    const changed = changedFields(previous.current, summary);
    previous.current = summary;
    if (changed.length === 0) return;
    setFlashing(changed);
    const timer = setTimeout(() => setFlashing([]), FLASH_MS);
    return () => clearTimeout(timer);
  }, [summaryKey]);

  if (!summary) return null;
  const items: { field: TripField; label: string; icon: LucideIcon; value: string | null }[] = [
    { field: "team", label: "Team", icon: Users, value: summary.team },
    { field: "place", label: "Where", icon: MapPin, value: summary.place },
    { field: "dates", label: "When", icon: CalendarDays, value: summary.dates },
    { field: "length", label: "Length", icon: CalendarRange, value: summary.length },
  ];
  return (
    <div className="tripbar" aria-label="Current trip">
      {items.map((item) =>
        item.value ? (
          <span key={item.field} className={`trip-item ${flashing.includes(item.field) ? "flash" : ""}`}>
            <item.icon size={14} aria-hidden="true" />
            <span className="muted">{item.label}</span> <strong>{item.value}</strong>
          </span>
        ) : null,
      )}
    </div>
  );
}
