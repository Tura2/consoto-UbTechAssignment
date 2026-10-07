// Runs one agent: a small LLM tool loop over that agent's own tools.
import { z } from "zod";
import type { AgentId } from "../../../shared/domain";
import type { Emit } from "../../../shared/events";
import type { ChatMessage, Llm } from "../llm/openrouter";
import { toChatTool } from "../llm/schema";
import { fail, runToolWithEvents, type AnyTool, type ToolContext, type ToolResult } from "../tools/types";
import type { AgentDef } from "./registry";

export type ToolRun = { tool: string; input: unknown; result: ToolResult };

export type AgentResult = {
  agent: AgentId;
  status: "ok" | "error" | "timeout";
  summary: string;
  toolRuns: ToolRun[];
};

function unknownTool(name: string, available: AnyTool[]): AnyTool {
  return {
    name,
    description: "",
    input: z.unknown(),
    execute: async () => fail("unknown_tool", `No tool named ${name}.`, `Use one of: ${available.map((tool) => tool.name).join(", ")}.`),
  };
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return { invalidJson: raw };
  }
}

// What the model sees from a tool: the data and gaps, never our internal source records.
function forModel(result: ToolResult): string {
  return JSON.stringify(
    result.ok ? { ok: true, summary: result.summary, data: result.data, gaps: result.gaps } : { ok: false, error: result.error },
  );
}

export async function runAgent(args: {
  def: AgentDef;
  task: string;
  extraContext?: string;
  ctx: ToolContext;
  llm: Llm;
  emit: Emit;
}): Promise<AgentResult> {
  const { def, ctx, llm, emit } = args;
  const started = Date.now();
  emit({ type: "agent_start", agent: def.id, task: args.task });
  const tools = new Map(def.tools.map((tool) => [tool.name, tool]));
  const chatTools = def.tools.map((tool) => toChatTool(tool.name, tool.description, tool.input));
  const system = [def.instructions, `Today is ${ctx.today}.`, `Current trip: ${JSON.stringify(ctx.trip)}`, args.extraContext ?? ""]
    .filter(Boolean)
    .join("\n\n");
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: args.task },
  ];
  const toolRuns: ToolRun[] = [];
  let summary = `Stopped after ${def.maxRounds} tool rounds.`;

  try {
    for (let round = 0; round < def.maxRounds; round++) {
      const { message } = await llm.complete({ who: def.id, messages, tools: chatTools, signal: ctx.signal }, emit);
      const calls = (message.tool_calls ?? []).filter((call) => call.type === "function");
      if (calls.length === 0) {
        summary = message.content?.trim() || "Done.";
        break;
      }
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      const results = await Promise.all(
        calls.map(async (call) => {
          const input = parseArguments(call.function.arguments);
          const tool = tools.get(call.function.name) ?? unknownTool(call.function.name, def.tools);
          const result = await runToolWithEvents({ tool, input, ctx, owner: def.id, emit });
          return { id: call.id, tool: call.function.name, input, result };
        }),
      );
      for (const run of results) {
        toolRuns.push({ tool: run.tool, input: run.input, result: run.result });
        messages.push({ role: "tool", tool_call_id: run.id, content: forModel(run.result) });
      }
    }
    emit({ type: "agent_end", agent: def.id, status: "ok", summary, ms: Date.now() - started });
    return { agent: def.id, status: "ok", summary, toolRuns };
  } catch (error) {
    const timedOut = ctx.signal.aborted && (ctx.signal.reason as Error | undefined)?.name === "TimeoutError";
    if (ctx.signal.aborted && !timedOut) throw error; // the user stopped the turn
    const status = timedOut ? "timeout" : "error";
    const text = timedOut ? "Ran out of time for this turn." : (error as Error).message;
    emit({ type: "agent_end", agent: def.id, status, summary: text, ms: Date.now() - started });
    return { agent: def.id, status, summary: text, toolRuns };
  }
}
