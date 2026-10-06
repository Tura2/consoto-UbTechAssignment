import type { AgentId } from "../../../shared/domain";

export const AGENT_IDS = ["budget_policy", "weather_calendar", "venues", "itinerary"] as const satisfies readonly AgentId[];
