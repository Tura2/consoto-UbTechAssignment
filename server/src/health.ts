// OpenRouter status for the header and the startup log. Uses GET /key and GET /models: no LLM requests.
import type { HealthInfo } from "../../shared/events";
import { OPENROUTER_BASE_URL } from "./config";

type KeyBody = { data?: { is_free_tier?: boolean; free_model_daily_requests?: { remaining?: number; limit?: number } } };
type ModelsBody = { data?: { id: string; supported_parameters?: string[] }[] };

export function createHealthCheck(
  apiKey: string,
  models: string[],
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): () => Promise<HealthInfo> {
  let cached: { at: number; info: HealthInfo } | null = null;

  async function getJson<T>(url: string, withKey: boolean): Promise<{ status: number; body: T | null } | null> {
    try {
      const response = await fetchImpl(url, {
        headers: withKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8_000),
      });
      return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
    } catch {
      return null;
    }
  }

  return async () => {
    if (cached && now() - cached.at < 60_000) return cached.info;
    const [key, list] = await Promise.all([
      getJson<KeyBody>(`${OPENROUTER_BASE_URL}/key`, true),
      getJson<ModelsBody>(`${OPENROUTER_BASE_URL}/models`, false),
    ]);
    const free = key?.body?.data?.free_model_daily_requests;
    const withTools = new Set(
      (list?.body?.data ?? []).filter((model) => (model.supported_parameters ?? []).includes("tools")).map((model) => model.id),
    );
    const info: HealthInfo = {
      keyValid: key === null ? null : key.status === 200 ? true : key.status === 401 ? false : null,
      freeRequestsLeft: free?.remaining ?? null,
      freeRequestsLimit: free?.limit ?? null,
      isFreeTier: key?.body?.data?.is_free_tier ?? null,
      models: models.map((id) => ({ id, available: list?.body ? withTools.has(id) : null })),
    };
    cached = { at: now(), info };
    return info;
  };
}

export function describeHealth(info: HealthInfo): string[] {
  const lines: string[] = [];
  if (info.keyValid === false) lines.push("OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.");
  if (info.keyValid === null) lines.push("Could not reach OpenRouter to check the key.");
  if (info.freeRequestsLeft !== null) lines.push(`Free model requests left today: ${info.freeRequestsLeft} of ${info.freeRequestsLimit ?? "?"}.`);
  if (info.isFreeTier) lines.push("This account never bought credits, so free models are limited to 50 requests per day.");
  for (const model of info.models) {
    if (model.available === false) lines.push(`Model not found or without tool support: ${model.id}. Update OPENROUTER_MODELS.`);
  }
  return lines;
}
