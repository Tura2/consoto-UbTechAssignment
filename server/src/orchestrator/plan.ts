// The orchestrator's routing decision: one LLM call that must return a plan through submit_plan.
import { z } from "zod";
import type { Trip } from "../../../shared/domain";
import type { Emit } from "../../../shared/events";
import { AGENT_IDS } from "../agents/ids";
import { AGENT_LIST } from "../agents/registry";
import type { ChatMessage, Llm } from "../llm/openrouter";
import { toChatTool } from "../llm/schema";
import { TripUpdateSchema, applyTripUpdate, namedCandidates } from "./trip";

// tripUpdate and agents are required (send {} or [] when there is nothing): with defaults the model saw
// them as optional and sometimes sent only reason and clarify, which silently ran nothing.
export const PlanSchema = z.object({
  tripUpdate: TripUpdateSchema.describe("Only the trip facts the latest message adds or changes ({} if none)"),
  agents: z
    .array(z.object({ agent: z.enum(AGENT_IDS), task: z.string().min(1).describe("A direct instruction with the cities, dates and team") }))
    .max(4)
    .describe("The agents to run ([] only to answer without them or to ask the clarify question)"),
  reason: z.string().min(1).describe("One sentence for the user: why these agents"),
  clarify: z.string().optional().describe("A question to ask instead of running agents, only if essential information is missing"),
});

export type Plan = z.infer<typeof PlanSchema>;

export const FALLBACK_PLAN: Plan = {
  tripUpdate: {},
  agents: [],
  reason: "I could not work out how to handle this message.",
  clarify: "Sorry, I did not get that. Could you rephrase what you need?",
};

const SUBMIT_PLAN = toChatTool("submit_plan", "Submit the routing plan for the latest user message.", PlanSchema);

export function plannerSystemPrompt(trip: Trip, today: string): string {
  const catalog = AGENT_LIST.map((agent) => `- ${agent.id}: ${agent.purpose}`).join("\n");
  return `You are the orchestrator of Consoto's offsite planning assistant. Read the latest user message and decide which specialist agents should handle it. Call submit_plan exactly once.

Agents:
${catalog}

Routing rules:
- Comparing or choosing destinations: budget_policy and weather_calendar.
- Weather, holidays or dates: weather_calendar.
- Costs, totals, budget or policy: budget_policy.
- Food, dietary needs, accessibility or places: venues.
- Drafting a plan or itinerary: itinerary, plus venues if food or access is mentioned.
- Choose the smallest set of agents that answers the message. Use no agents for greetings or questions about the assistant itself.
- Write each task as a direct instruction that names the cities, dates and team.
- When comparing destinations, name every candidate city from the current trip in each task.

Trip facts:
- tripUpdate holds only what the latest message adds or changes.
- candidateCities holds only cities the user named in the latest message. Leave it out when they named none.
- Never compute dates: give searchPeriod as a month and a part of it, and startDay only if the user names a date.
- When the user picks, confirms or switches a city (for example "Lisbon sounds good", "let's go with it", "what about Prague?"), set tripUpdate.city to that city.
- Never ask the user to choose dates: if no start date is set, code assumes the earliest clean window and the answer says so.
- Never ask the user to choose a city when they ask where to go, what it costs or for a plan: compare the candidate cities instead.
- Use clarify only when the message cannot be answered at all without new information, never for dates, cities or the team.

Today is ${today}.
Current trip: ${JSON.stringify(trip)}`;
}

export function parsePlan(json: string): { success: true; plan: Plan } | { success: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { success: false, error: "the arguments were not valid JSON" };
  }
  const result = PlanSchema.safeParse(raw);
  return result.success ? { success: true, plan: result.data } : { success: false, error: z.prettifyError(result.error) };
}

// A valid plan that only asks about something the trip already has (seen live on the free model: "Which European
// cities?" when code fills the region's cities). The planner is asked once more, to route the message instead.
// A missing search period needs no retry: code reads the month from the user's words (fillPeriod in trip.ts).
function planProblem(plan: Plan, trip: Trip, message: string, today: string): string | null {
  const next = applyTripUpdate(trip, namedCandidates(plan.tripUpdate, message), today);
  const cities = next.city ? [next.city] : next.candidateCities;
  if (plan.agents.length === 0 && plan.clarify && cities.length > 0 && next.searchWindow) {
    return `Do not ask: the trip already has ${cities.join(", ")} and the dates ${next.searchWindow.from} to ${next.searchWindow.to}. Route the message to the agents`;
  }
  return null;
}

export async function makePlan(args: {
  llm: Llm;
  history: ChatMessage[];
  message: string;
  trip: Trip;
  today: string;
  signal: AbortSignal;
  emit: Emit;
}): Promise<Plan> {
  const messages: ChatMessage[] = [
    { role: "system", content: plannerSystemPrompt(args.trip, args.today) },
    ...args.history,
    { role: "user", content: args.message },
  ];
  let usable: Plan | null = null; // a valid plan with a problem, kept in case the second attempt fails
  for (let attempt = 0; attempt < 2; attempt++) {
    const { message } = await args.llm.complete(
      {
        who: "planner",
        messages,
        tools: [SUBMIT_PLAN],
        toolChoice: { type: "function", function: { name: "submit_plan" } },
        maxTokens: 5_000,
        signal: args.signal,
      },
      args.emit,
    );
    const call = message.tool_calls?.find((c) => c.type === "function" && c.function.name === "submit_plan");
    if (call && call.type === "function") {
      const parsed = parsePlan(call.function.arguments);
      const problem = parsed.success ? planProblem(parsed.plan, args.trip, args.message, args.today) : null;
      // A retry often sends only its corrections, so the first attempt's trip facts are kept underneath.
      if (parsed.success && (problem === null || attempt === 1)) {
        return usable ? { ...parsed.plan, tripUpdate: { ...usable.tripUpdate, ...parsed.plan.tripUpdate } } : parsed.plan;
      }
      if (parsed.success) usable = parsed.plan;
      const feedback = parsed.success ? `${problem}. Call submit_plan again.` : `Invalid plan: ${parsed.error}. Call submit_plan again with valid arguments.`;
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: [call] });
      messages.push({ role: "tool", tool_call_id: call.id, content: feedback });
    } else {
      messages.push({ role: "assistant", content: message.content ?? "" });
      messages.push({ role: "user", content: "You must call submit_plan with the routing plan." });
    }
  }
  return usable ?? FALLBACK_PLAN;
}
