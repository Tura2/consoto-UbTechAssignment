// The four specialist agents: who they are, what they may use, and their instructions.
import type { AgentId } from "../../../shared/domain";
import type { AgentsInfo } from "../../../shared/events";
import { budgetEstimateCost } from "../tools/budget-estimate-cost";
import { budgetGetTeam } from "../tools/budget-get-team";
import { calendarFindCleanWindows } from "../tools/calendar-find-clean-windows";
import { itinerarySubmitPlan } from "../tools/itinerary-submit-plan";
import { placesFindForTeam } from "../tools/places-find-for-team";
import { policyCheck } from "../tools/policy-check";
import type { AnyTool } from "../tools/types";
import { weatherGetOutlook } from "../tools/weather-get-outlook";

export type AgentDef = {
  id: AgentId;
  name: string;
  purpose: string;
  instructions: string;
  tools: AnyTool[];
  maxRounds: number;
};

const COMMON_RULES = `Rules:
- Get facts only from your tools. Never compute, estimate or invent numbers, dates, prices or venues.
- If a tool reports a gap or an error, say so plainly. Do not fill the gap.
- Call several tools in one round when they do not depend on each other.
- When you have what you need, stop calling tools and reply with a 2-3 sentence summary of what you found.`;

export const AGENTS: Record<AgentId, AgentDef> = {
  budget_policy: {
    id: "budget_policy",
    name: "Budget & policy",
    purpose: "Costs per person and per team in EUR and ILS at the latest ECB rate, team data, and Consoto's offsite policy.",
    maxRounds: 3,
    tools: [budgetEstimateCost, budgetGetTeam, policyCheck],
    instructions: `You are the Budget & policy agent of Consoto's offsite planning assistant. You answer cost, budget and policy questions from Consoto's internal data and the latest ECB exchange rate.
- To compare destinations, call budget_estimate_cost once with all candidate cities.
- For a chosen city, call budget_estimate_cost for that city.
- The orchestrator runs the full policy check at the end of every turn. Call policy_check only if the task asks about a specific rule.
${COMMON_RULES}`,
  },
  weather_calendar: {
    id: "weather_calendar",
    name: "Weather & calendar",
    purpose: "Holidays in Israel and at the destination, clean date windows, and the weather (forecast, or a climate average when the dates are far away).",
    maxRounds: 3,
    tools: [calendarFindCleanWindows, weatherGetOutlook],
    instructions: `You are the Weather & calendar agent of Consoto's offsite planning assistant. You find holidays in Israel and at the destination, the clean date windows, and the weather outlook.
- Call both tools in the same round, for all the requested cities, using the trip's search window and length.
- If there is no forecast, say the weather is a climate average of past years, not a forecast.
${COMMON_RULES}`,
  },
  venues: {
    id: "venues",
    name: "Venues scout",
    purpose: "Restaurants that fit the team's dietary needs and wheelchair-accessible sights, from OpenStreetMap.",
    maxRounds: 2,
    tools: [placesFindForTeam],
    instructions: `You are the Venues scout of Consoto's offsite planning assistant. You find restaurants that fit the team's dietary needs and wheelchair-accessible sights, from OpenStreetMap.
- Never say a place is accessible or fits a diet unless the tool data says so. Missing tags mean unknown.
${COMMON_RULES}`,
  },
  itinerary: {
    id: "itinerary",
    name: "Itinerary writer",
    purpose: "Drafts the day-by-day plan from the verified venues, and fixes whatever the code check reports.",
    maxRounds: 3,
    tools: [itinerarySubmitPlan],
    instructions: `You are the Itinerary writer of Consoto's offsite planning assistant. You draft the day-by-day plan.
- Use only venues from the venues list below, by their id.
- Each day has a morning activity, lunch, an afternoon activity and dinner, on the trip's dates.
- Every meal needs an option for every dietary need. If no listed venue covers a need, add catering for it.
- Prefer places with wheelchair "yes". Never use a place with wheelchair "no".
- Submit with itinerary_submit_plan. If it returns problems, fix them and submit once more.
${COMMON_RULES}`,
  },
};

export const AGENT_LIST: AgentDef[] = Object.values(AGENTS);

export const ROUTING_TEXT =
  "One LLM call reads the message and the trip so far and returns a plan: which agents to run, what to ask each, and why. " +
  "Code checks the plan, updates the trip facts (dates are computed in code), runs the agents (in parallel when they do not depend on each other), " +
  "always runs the policy check itself, and builds the result cards. A final LLM call writes the answer from the agents' data.";

export const CODE_VS_MODEL_TEXT =
  "Code computes every number, date and rule: costs, the ECB conversion, holiday windows, climate averages, venue matching, " +
  "the itinerary check and the policy verdict. The model decides which agents and tools to use, with which arguments, and writes the wording and the recommendation.";

export function agentsInfo(): AgentsInfo {
  return {
    routing: ROUTING_TEXT,
    codeVsModel: CODE_VS_MODEL_TEXT,
    agents: AGENT_LIST.map((agent) => ({
      id: agent.id,
      name: agent.name,
      purpose: agent.purpose,
      tools: agent.tools.map((tool) => ({ name: tool.name, description: tool.description })),
    })),
  };
}
