// The contract every tool follows, and the code that runs a tool safely.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ItineraryCheck, ItineraryPlan, Source, Trip, VenuesResult } from "../../../shared/domain";
import type { Emit, StepOwner, StreamEvent } from "../../../shared/events";
import type { DataSources } from "../clients/data-sources";

export type ToolError = { code: string; message: string; hint: string };

export type ToolResult =
  | { ok: true; summary: string; data: unknown; sources: Source[]; gaps: string[] }
  | { ok: false; summary: string; error: ToolError };

export type Findings = {
  venues: VenuesResult | null;
  itinerary: { plan: ItineraryPlan; check: ItineraryCheck } | null;
};

export type ToolContext = {
  trip: Trip;
  findings: Findings;
  data: DataSources;
  signal: AbortSignal;
  today: string;
  scratch: Record<string, number>;
};

export type Tool<I> = {
  name: string;
  description: string;
  input: z.ZodType;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
};

// Registries hold tools with different input types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any>;

export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");

// Infers the execute() input type from the zod schema.
export function defineTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: S;
  execute(input: z.output<S>, ctx: ToolContext): Promise<ToolResult>;
}): Tool<z.output<S>> {
  return tool;
}

export function ok(summary: string, data: unknown, sources: Source[] = [], gaps: string[] = []): ToolResult {
  return { ok: true, summary, data, sources, gaps };
}

export function fail(code: string, message: string, hint: string): ToolResult {
  return { ok: false, summary: message, error: { code, message, hint } };
}

export async function runTool(tool: AnyTool, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const parsed = tool.input.safeParse(rawInput);
  if (!parsed.success) {
    return fail(
      "invalid_input",
      `Invalid input for ${tool.name}: ${z.prettifyError(parsed.error)}`,
      "Fix the arguments to match the tool's schema and call it again.",
    );
  }
  try {
    return await tool.execute(parsed.data, ctx);
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    return fail(
      "source_unavailable",
      `${tool.name} could not get its data: ${(error as Error).message}`,
      "Tell the user this data is unavailable right now. Do not guess it.",
    );
  }
}

export function toolEndEvent(callId: string, result: ToolResult, ms: number): StreamEvent {
  return result.ok
    ? {
        type: "tool_end",
        callId,
        ok: true,
        summary: result.summary,
        data: result.data,
        sources: result.sources,
        gaps: result.gaps,
        cached: result.sources.length > 0 && result.sources.every((source) => source.cached),
        ms,
      }
    : { type: "tool_end", callId, ok: false, summary: result.summary, data: result.error, sources: [], gaps: [], cached: false, ms };
}

export async function runToolWithEvents(args: {
  tool: AnyTool;
  input: unknown;
  ctx: ToolContext;
  owner: StepOwner;
  emit: Emit;
}): Promise<ToolResult> {
  const callId = randomUUID();
  args.emit({ type: "tool_start", callId, owner: args.owner, tool: args.tool.name, input: args.input });
  const started = Date.now();
  const result = await runTool(args.tool, args.input, args.ctx);
  args.emit(toolEndEvent(callId, result, Date.now() - started));
  return result;
}
