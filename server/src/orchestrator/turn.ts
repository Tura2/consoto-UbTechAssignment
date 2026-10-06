// One chat turn: plan (LLM), trip facts (code), agents (LLM + code tools), policy (code), cards (code), answer (LLM).
import { randomUUID } from "node:crypto";
import type { AgentId, PolicyVerdict, VenuesResult } from "../../../shared/domain";
import type { Emit } from "../../../shared/events";
import { AGENTS } from "../agents/registry";
import { runAgent, type AgentResult } from "../agents/runner";
import type { DataSources } from "../clients/data-sources";
import { getTeam, teamNeeds } from "../data/consoto-data";
import { datesOf } from "../domain/dates";
import { allPlaces } from "../domain/places";
import type { Llm } from "../llm/openrouter";
import { historyMessages, type Conversation, type Turn } from "../state/conversations";
import { calendarFindCleanWindows, type CalendarData } from "../tools/calendar-find-clean-windows";
import type { ItineraryData } from "../tools/itinerary-submit-plan";
import { policyCheck } from "../tools/policy-check";
import { runToolWithEvents, type Findings, type ToolContext } from "../tools/types";
import { buildAnswerContext, streamAnswer } from "./answer";
import { buildCards } from "./cards";
import { makePlan, type Plan } from "./plan";
import { lastToolData } from "./tool-data";
import { applyTripUpdate, depsKey, dropStaleFindings } from "./trip";

export type TurnDeps = { llm: Llm; data: DataSources; today: () => string; agentPhaseMs?: number };

// Findings from earlier turns that tools may read (the venue list and the latest itinerary).
export function findingsView(conversation: Conversation): Findings {
  const venues = conversation.findings.venues
    ? lastToolData<VenuesResult>([conversation.findings.venues.result], "places_find_for_team")
    : null;
  const itinerary = conversation.findings.itinerary
    ? lastToolData<ItineraryData>([conversation.findings.itinerary.result], "itinerary_submit_plan")
    : null;
  return { venues, itinerary: itinerary ? { plan: itinerary.plan, check: itinerary.check } : null };
}

function toolContext(conversation: Conversation, deps: TurnDeps, signal: AbortSignal, today: string): ToolContext {
  return { trip: conversation.trip, findings: findingsView(conversation), data: deps.data, signal, today, scratch: {} };
}

export async function runTurn(conversation: Conversation, message: string, deps: TurnDeps, send: Emit, signal: AbortSignal): Promise<Turn> {
  const turn: Turn = { id: randomUUID(), userMessage: message, events: [], answer: "", status: "running" };
  const history = historyMessages(conversation);
  conversation.turns.push(turn);
  const started = Date.now();
  let llmCalls = 0;
  const emit: Emit = (event) => {
    if (event.type === "llm_call") llmCalls++;
    if (event.type === "answer_delta") turn.answer += event.text;
    turn.events.push(event);
    send(event);
  };

  emit({ type: "turn_start", conversationId: conversation.id, turnId: turn.id });
  let status: "done" | "stopped" | "error" = "done";
  let error: string | null = null;
  try {
    const today = deps.today();
    const plan = await makePlan({ llm: deps.llm, history, message, trip: conversation.trip, today, signal, emit });
    signal.throwIfAborted(); // never change the trip for a turn the user already left
    conversation.trip = applyTripUpdate(conversation.trip, plan.tripUpdate, today);
    dropStaleFindings(conversation);
    emit({ type: "plan", agents: plan.agents, reason: plan.reason, trip: conversation.trip, clarify: plan.clarify ?? null });

    if (plan.clarify) {
      emit({ type: "answer_delta", text: plan.clarify });
    } else {
      const results = await runAgents(conversation, plan, deps, emit, signal, today);
      signal.throwIfAborted();
      const policy = conversation.trip.city ? await runPolicyCheck(conversation, deps, emit, signal, today) : null;
      const showPolicy = plan.agents.some((entry) => entry.agent === "budget_policy" || entry.agent === "itinerary");
      for (const card of buildCards({ results, policy, showPolicy, trip: conversation.trip })) emit({ type: "card", card });
      const context = buildAnswerContext({ trip: conversation.trip, plan, results, policy });
      await streamAnswer({ llm: deps.llm, history, message, context, signal, emit });
    }
  } catch (caught) {
    status = signal.aborted ? "stopped" : "error";
    error = signal.aborted ? null : (caught as Error).message;
  }
  turn.status = status;
  emit({ type: "turn_end", status, llmCalls, ms: Date.now() - started, error });
  return turn;
}

async function runAgents(
  conversation: Conversation,
  plan: Plan,
  deps: TurnDeps,
  emit: Emit,
  signal: AbortSignal,
  today: string,
): Promise<AgentResult[]> {
  const tasks = new Map<AgentId, string>(plan.agents.map((entry) => [entry.agent, entry.task]));
  const { trip } = conversation;
  // The itinerary may only use venues the scout found, so make sure there is a venue list.
  if (tasks.has("itinerary") && trip.city && !conversation.findings.venues) {
    tasks.set("venues", `Find food for the team's diets and wheelchair-accessible sights in ${trip.city} for the ${trip.team ?? "platform"} team.`);
  }
  if ((tasks.has("itinerary") || tasks.has("budget_policy")) && trip.city && trip.searchWindow && !trip.start) {
    await assumeStartDate(conversation, deps, emit, signal, today);
  }

  // One time budget for the whole agent phase. An agent still running after it reports a timeout.
  const phaseSignal = AbortSignal.any([signal, AbortSignal.timeout(deps.agentPhaseMs ?? 45_000)]);
  const runOne = async (agent: AgentId): Promise<AgentResult> => {
    const result = await runAgent({
      def: AGENTS[agent],
      task: tasks.get(agent) ?? "",
      extraContext: agent === "itinerary" ? itineraryContext(conversation) : undefined,
      ctx: toolContext(conversation, deps, phaseSignal, today),
      llm: deps.llm,
      emit,
    });
    if (result.status === "ok") conversation.findings[agent] = { depsKey: depsKey(agent, conversation.trip), result };
    return result;
  };
  const firstPhase = await Promise.all([...tasks.keys()].filter((agent) => agent !== "itinerary").map(runOne));
  const secondPhase = tasks.has("itinerary") ? [await runOne("itinerary")] : [];
  return [...firstPhase, ...secondPhase];
}

// No dates chosen yet: take the earliest clean window and say so in the answer.
async function assumeStartDate(conversation: Conversation, deps: TurnDeps, emit: Emit, signal: AbortSignal, today: string): Promise<void> {
  const { trip } = conversation;
  if (!trip.city || !trip.searchWindow) return;
  const result = await runToolWithEvents({
    tool: calendarFindCleanWindows,
    input: { cities: [trip.city], from: trip.searchWindow.from, to: trip.searchWindow.to, days: trip.days },
    ctx: toolContext(conversation, deps, signal, today),
    owner: "orchestrator",
    emit,
  });
  if (!result.ok) return;
  const firstClean = (result.data as CalendarData).cities[0]?.windows.find((window) => window.clean);
  if (firstClean) conversation.trip = { ...conversation.trip, start: { date: firstClean.start, source: "assumed" } };
}

async function runPolicyCheck(conversation: Conversation, deps: TurnDeps, emit: Emit, signal: AbortSignal, today: string): Promise<PolicyVerdict | null> {
  const result = await runToolWithEvents({ tool: policyCheck, input: {}, ctx: toolContext(conversation, deps, signal, today), owner: "orchestrator", emit });
  return result.ok ? (result.data as PolicyVerdict) : null;
}

function itineraryContext(conversation: Conversation): string {
  const { trip } = conversation;
  const venues = findingsView(conversation).venues;
  const places = venues
    ? allPlaces(venues).map((place) => ({ id: place.id, name: place.name, kind: place.kind, diets: place.diets, wheelchair: place.wheelchair }))
    : [];
  const team = trip.team ? getTeam(trip.team) : null;
  return [
    `Trip dates: ${trip.start ? datesOf(trip.start.date, trip.days).join(", ") : "not chosen yet"}.`,
    `Team dietary needs: ${team ? teamNeeds(team).diets.join(", ") || "none" : "unknown"}.`,
    `Venues list (use these ids only): ${JSON.stringify(places)}`,
  ].join("\n");
}
