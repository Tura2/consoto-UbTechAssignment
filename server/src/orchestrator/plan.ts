// The orchestrator's routing decision: one LLM call that must return a plan through submit_plan.
import { z } from "zod";
import type { Trip } from "../../../shared/domain";
import type { Emit } from "../../../shared/events";
import { AGENT_IDS } from "../agents/ids";
import { AGENT_LIST } from "../agents/registry";
import type { ChatMessage, Llm } from "../llm/openrouter";
import { toChatTool } from "../llm/schema";
import { TripUpdateSchema } from "./trip";

export const PlanSchema = z.object({
  tripUpdate: TripUpdateSchema.default({}).describe("Only the trip facts the latest message adds or changes"),
  agents: z
    .array(z.object({ agent: z.enum(AGENT_IDS), task: z.string().min(1).describe("A direct instruction with the cities, dates and team") }))
    .max(4)
    .default([]),
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const { message } = await args.llm.complete(
      {
        who: "planner",
        messages,
        tools: [SUBMIT_PLAN],
        toolChoice: { type: "function", function: { name: "submit_plan" } },
        maxTokens: 2_000,
        signal: args.signal,
      },
      args.emit,
    );
    const call = message.tool_calls?.find((c) => c.type === "function" && c.function.name === "submit_plan");
    if (call && call.type === "function") {
      const parsed = parsePlan(call.function.arguments);
      if (parsed.success) return parsed.plan;
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: [call] });
      messages.push({ role: "tool", tool_call_id: call.id, content: `Invalid plan: ${parsed.error}. Call submit_plan again with valid arguments.` });
    } else {
      messages.push({ role: "assistant", content: message.content ?? "" });
      messages.push({ role: "user", content: "You must call submit_plan with the routing plan." });
    }
  }
  return FALLBACK_PLAN;
}
