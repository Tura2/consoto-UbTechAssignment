import type { AgentId, DietNeed } from "../../shared/domain";

export const AGENT_NAMES: Record<AgentId, string> = {
  budget_policy: "Budget & policy",
  weather_calendar: "Weather & calendar",
  venues: "Venues scout",
  itinerary: "Itinerary writer",
};

export const DIET_NAMES: Record<DietNeed, string> = { vegan: "Vegan", kosher: "Kosher", gluten_free: "Gluten-free" };

export const ils = (amount: number | null) => (amount === null ? "-" : `${amount.toLocaleString("en-US")} ILS`);
export const eur = (amount: number) => `${amount.toLocaleString("en-US")} EUR`;
export const pct = (share: number) => `${Math.round(share * 100)}%`;
export const shortModel = (model: string) => model.split("/").pop()?.replace(":free", "") ?? model;
export const seconds = (ms: number | null) => (ms === null ? "" : `${(ms / 1000).toFixed(1)} s`);

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function range(from: string, to: string): string {
  return from === to ? shortDate(from) : `${shortDate(from)} to ${shortDate(to)}`;
}
