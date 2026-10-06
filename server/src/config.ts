import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/src/config.ts -> repo root is two folders up.
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const USER_AGENT = "ConsotoOffsiteAssistant/1.0 (local demo)";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODELS =
  "nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,openrouter/free";

export type Config = {
  apiKey: string;
  models: string[];
  port: number;
  llmRequestsPerMinute: number;
  cacheDir: string;
};

type Env = Record<string, string | undefined>;

export function loadDotEnv(file = path.join(ROOT_DIR, ".env")): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function loadConfig(env: Env = process.env): Config {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Copy .env.example to .env and add your OpenRouter key.");
  }
  const models = (env.OPENROUTER_MODELS ?? DEFAULT_MODELS)
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new Error("OPENROUTER_MODELS is empty. List at least one free model that supports tool calling.");
  }
  return {
    apiKey,
    models,
    port: positiveInt(env.PORT, 3000, "PORT"),
    llmRequestsPerMinute: positiveInt(env.LLM_REQUESTS_PER_MINUTE, 15, "LLM_REQUESTS_PER_MINUTE"),
    cacheDir: cacheDirFromEnv(env),
  };
}

export function cacheDirFromEnv(env: Env = process.env): string {
  return path.resolve(ROOT_DIR, env.CACHE_DIR ?? ".cache");
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number, got "${raw}".`);
  }
  return value;
}
