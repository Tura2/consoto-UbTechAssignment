// Checks that each configured model answers a forced tool call, and how fast.
// Usage: npm run check-models (needs OPENROUTER_API_KEY in .env)
import type OpenAI from "openai";
import { loadConfig, loadDotEnv } from "../config";
import { createHealthCheck, describeHealth } from "../health";
import { openRouterClient } from "../llm/openrouter";

loadDotEnv();
const config = loadConfig();
const client = openRouterClient(config.apiKey);

for (const line of describeHealth(await createHealthCheck(config.apiKey, config.models)())) console.log(line);

const tool = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the weather for a city.",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

for (const model of config.models) {
  const started = Date.now();
  try {
    const response = (await client.create(
      {
        model,
        messages: [{ role: "user", content: "What is the weather in Lisbon? Use the tool." }],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "get_weather" } },
        max_tokens: 2000,
      },
      { signal: AbortSignal.timeout(60_000) },
    )) as OpenAI.Chat.Completions.ChatCompletion;
    const call = response.choices[0]?.message.tool_calls?.[0];
    const ok = call?.type === "function" && call.function.name === "get_weather";
    console.log(`${model}: ${ok ? "tool call ok" : "NO tool call"} in ${Date.now() - started} ms (served by ${response.model})`);
  } catch (error) {
    console.log(`${model}: FAILED after ${Date.now() - started} ms: ${(error as Error).message}`);
  }
}
