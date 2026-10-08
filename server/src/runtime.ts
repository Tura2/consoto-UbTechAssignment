// Builds the real dependencies (HTTP cache, data sources, OpenRouter) from the config.
import { createDataSources } from "./clients/data-sources";
import { createHttp } from "./clients/http";
import { CACHE_DIR, USER_AGENT, type Config } from "./config";
import { createLimiter, createLlm, openRouterClient } from "./llm/openrouter";
import type { TurnDeps } from "./orchestrator/turn";

// Today's date where the server runs, as YYYY-MM-DD.
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function createRuntime(config: Config): { turnDeps: TurnDeps } {
  const http = createHttp({ cacheDir: CACHE_DIR, userAgent: USER_AGENT });
  const llm = createLlm({
    client: openRouterClient(config.apiKey),
    models: config.models,
    limiter: createLimiter(config.llmRequestsPerMinute),
    reasoningEffort: "low",
  });
  return { turnDeps: { llm, data: createDataSources(http), today: todayIso } };
}
