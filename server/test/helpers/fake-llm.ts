import type { LlmCaller } from "../../../shared/events";
import type { AssistantMessage, Llm } from "../../src/llm/openrouter";

// An Llm that replays scripted replies per caller. Each call emits an llm_call event like the real one.
export function scriptedLlm(script: Partial<Record<LlmCaller, AssistantMessage[]>>, answerText = "Here is the answer.") {
  const queues = new Map(Object.entries(script).map(([who, replies]) => [who, [...(replies ?? [])]]));
  const calls: LlmCaller[] = [];
  const llm: Llm = {
    async complete(request, emit) {
      calls.push(request.who);
      const next = queues.get(request.who)?.shift();
      if (!next) throw new Error(`No scripted reply for ${request.who}`);
      emit({ type: "llm_call", who: request.who, model: "fake/model", attempt: 1, status: "ok", ms: 1, detail: null, tokens: null });
      return { message: next, model: "fake/model" };
    },
    async stream(request, emit, onText) {
      calls.push(request.who);
      emit({ type: "llm_call", who: request.who, model: "fake/model", attempt: 1, status: "ok", ms: 1, detail: null, tokens: null });
      onText(answerText);
      return { text: answerText, model: "fake/model" };
    },
  };
  return { llm, calls };
}

export function toolCalls(list: { name: string; args: unknown }[]): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: list.map((call, index) => ({
      id: `call_${index}_${call.name}`,
      type: "function" as const,
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    })),
  } as AssistantMessage;
}

export function toolCall(name: string, args: unknown): AssistantMessage {
  return toolCalls([{ name, args }]);
}

export function text(content: string): AssistantMessage {
  return { role: "assistant", content, refusal: null } as AssistantMessage;
}
