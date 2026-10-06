// OpenRouter through the official openai client. We run our own fallback loop instead of
// OpenRouter's `models` parameter, so every attempt, rate limit and fallback shows in the chat.
import OpenAI from "openai";
import type { Emit, LlmCaller } from "../../../shared/events";
import { OPENROUTER_BASE_URL } from "../config";
import { sleepMs } from "../lib/sleep";

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;
export type ToolChoice = OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
export type AssistantMessage = OpenAI.Chat.Completions.ChatCompletionMessage;
type Completion = OpenAI.Chat.Completions.ChatCompletion;
type Chunk = OpenAI.Chat.Completions.ChatCompletionChunk & { error?: { message?: string } };

// The slice of the openai client we use, so tests can pass a fake.
export type ChatClient = { create(body: Record<string, unknown>, options: { signal: AbortSignal }): Promise<unknown> };

export function openRouterClient(apiKey: string): ChatClient {
  const client = new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    maxRetries: 0, // retries and fallbacks are ours, below
    timeout: 60_000,
    defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-OpenRouter-Title": "Consoto Offsite Assistant" },
  });
  return {
    create: (body, options) =>
      client.chat.completions.create(body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParams, options),
  };
}

export type CompleteRequest = {
  who: LlmCaller;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
  signal: AbortSignal;
};
export type StreamRequest = Omit<CompleteRequest, "tools" | "toolChoice">;

export type Llm = {
  complete(request: CompleteRequest, emit: Emit): Promise<{ message: AssistantMessage; model: string }>;
  stream(request: StreamRequest, emit: Emit, onText: (text: string) => void): Promise<{ text: string; model: string }>;
};

export class LlmError extends Error {
  constructor(message: string, readonly kind: "fatal" | "exhausted" | "interrupted") {
    super(message);
    this.name = "LlmError";
  }
}

class EmptyReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyReplyError";
  }
}

export type Limiter = { acquire(signal: AbortSignal, onWait: (ms: number) => void): Promise<void> };

// At most `perMinute` requests in any rolling minute; extra requests wait their turn.
export function createLimiter(
  perMinute: number,
  now: () => number = Date.now,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = sleepMs,
): Limiter {
  const stamps: number[] = [];
  return {
    async acquire(signal, onWait) {
      for (;;) {
        const time = now();
        while (stamps.length > 0 && time - stamps[0] >= 60_000) stamps.shift();
        if (stamps.length < perMinute) {
          stamps.push(time);
          return;
        }
        const wait = stamps[0] + 60_000 - time;
        onWait(wait);
        await sleep(wait, signal);
      }
    },
  };
}

type Failure = "rate_limited" | "next_model" | "fatal" | "abort";

export function classifyFailure(error: unknown, signal: AbortSignal): Failure {
  if (signal.aborted) return "abort";
  const status = (error as { status?: number }).status;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 402 || status === 403) return "fatal";
  // Network errors, timeouts, 5xx, empty replies, and a 400 or 404 that this one model cannot serve.
  return "next_model";
}

function fatalMessage(error: unknown): string {
  const status = (error as { status?: number }).status;
  if (status === 401) return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.";
  if (status === 402) return "The OpenRouter account has no credits or a negative balance.";
  return `OpenRouter refused the request (HTTP ${status}): ${(error as Error).message}`;
}

export function retryAfterMs(error: unknown): number | null {
  const headers = (error as { headers?: unknown }).headers;
  const raw = headers instanceof Headers ? headers.get("retry-after") : (headers as Record<string, string> | undefined)?.["retry-after"];
  const seconds = Number(raw);
  return raw && Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 10_000) : null;
}

type Tokens = { prompt: number; completion: number } | null;

export function createLlm(options: {
  client: ChatClient;
  models: string[];
  limiter: Limiter;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  reasoningEffort?: "low" | null;
}): Llm {
  const sleep = options.sleep ?? sleepMs;
  const reasoning = options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {};

  async function withFallback<T>(
    who: LlmCaller,
    signal: AbortSignal,
    emit: Emit,
    attempt: (model: string) => Promise<{ value: T; tokens: Tokens }>,
  ): Promise<T> {
    let attemptNo = 0;
    let waitBeforeRetry: number | null = null;
    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0) {
        const wait = waitBeforeRetry ?? 2_000;
        emit({ type: "llm_wait", who, waitMs: wait, reason: "retry_after" });
        await sleep(wait, signal);
      }
      for (const model of options.models) {
        attemptNo++;
        await options.limiter.acquire(signal, (ms) => emit({ type: "llm_wait", who, waitMs: ms, reason: "local_limit" }));
        const started = Date.now();
        try {
          const { value, tokens } = await attempt(model);
          emit({ type: "llm_call", who, model, attempt: attemptNo, status: "ok", ms: Date.now() - started, detail: null, tokens });
          return value;
        } catch (error) {
          if (signal.aborted) throw error;
          const failure = classifyFailure(error, signal);
          const status = failure === "rate_limited" ? "rate_limited" : error instanceof EmptyReplyError ? "empty" : "error";
          emit({ type: "llm_call", who, model, attempt: attemptNo, status, ms: Date.now() - started, detail: (error as Error).message, tokens: null });
          if (error instanceof LlmError) throw error; // an interrupted stream is never retried
          if (failure === "fatal") throw new LlmError(fatalMessage(error), "fatal");
          waitBeforeRetry = retryAfterMs(error) ?? waitBeforeRetry;
        }
      }
    }
    throw new LlmError("All configured models are busy or rate limited right now. Try again in a minute.", "exhausted");
  }

  return {
    complete(request, emit) {
      return withFallback(request.who, request.signal, emit, async (model) => {
        const response = (await options.client.create(
          {
            model,
            messages: request.messages,
            tools: request.tools,
            tool_choice: request.toolChoice,
            max_tokens: request.maxTokens ?? 3_000,
            ...reasoning,
          },
          { signal: request.signal },
        )) as Completion;
        const choice = response.choices?.[0];
        const message = choice?.message;
        if (!message || (!message.content && !message.tool_calls?.length)) {
          throw new EmptyReplyError(`Empty reply (finish_reason: ${choice?.finish_reason ?? "none"})`);
        }
        const tokens = response.usage ? { prompt: response.usage.prompt_tokens, completion: response.usage.completion_tokens } : null;
        return { value: { message, model: response.model || model }, tokens };
      });
    },

    stream(request, emit, onText) {
      return withFallback(request.who, request.signal, emit, async (model) => {
        const stream = (await options.client.create(
          { model, messages: request.messages, stream: true, max_tokens: request.maxTokens ?? 3_000, ...reasoning },
          { signal: request.signal },
        )) as AsyncIterable<Chunk>;
        let text = "";
        let servedBy = model;
        try {
          for await (const chunk of stream) {
            if (chunk.error) throw new Error(chunk.error.message ?? "the provider reported an error mid-stream");
            servedBy = chunk.model || servedBy;
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              text += delta;
              onText(delta);
            }
          }
        } catch (error) {
          if (text.length > 0 && !request.signal.aborted) {
            throw new LlmError(`The answer was interrupted: ${(error as Error).message}`, "interrupted");
          }
          throw error;
        }
        if (!text) throw new EmptyReplyError("The model streamed an empty reply");
        return { value: { text, model: servedBy }, tokens: null };
      });
    },
  };
}
