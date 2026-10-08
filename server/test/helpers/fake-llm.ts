import type { LlmCaller } from "../../../shared/events";
import type { AssistantMessage, ChatMessage, Llm } from "../../src/llm/openrouter";

// An Llm that replays scripted replies per caller. Each call emits an llm_call event like the real one.
export function scriptedLlm(script: Partial<Record<LlmCaller, AssistantMessage[]>>, answerText = "Here is the answer.") {
  const queues = new Map(Object.entries(script).map(([who, replies]) => [who, [...(replies ?? [])]]));
  const calls: LlmCaller[] = [];
  const requests: { who: LlmCaller; messages: ChatMessage[] }[] = [];
  const llm: Llm = {
    async complete(request, emit) {
      calls.push(request.who);
      requests.push({ who: request.who, messages: request.messages });
      const next = queues.get(request.who)?.shift();
      if (!next) throw new Error(`No scripted reply for ${request.who}`);
      emit({ type: "llm_call", who: request.who, model: "fake/model", status: "ok", ms: 1, detail: null });
      return next;
    },
    async stream(request, emit, onText) {
      calls.push(request.who);
      requests.push({ who: request.who, messages: request.messages });
      emit({ type: "llm_call", who: request.who, model: "fake/model", status: "ok", ms: 1, detail: null });
      onText(answerText);
      return answerText;
    },
  };
  return { llm, calls, requests };
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
