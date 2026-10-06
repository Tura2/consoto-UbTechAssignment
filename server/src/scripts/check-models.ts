// Checks that each configured model answers a forced tool call, and how fast.
// Usage: npm run check-models (needs OPENROUTER_API_KEY in .env)
import OpenAI from "openai";
import { OPENROUTER_BASE_URL, loadConfig, loadDotEnv } from "../config";

loadDotEnv();
const config = loadConfig();
const client = new OpenAI({ apiKey: config.apiKey, baseURL: OPENROUTER_BASE_URL, maxRetries: 0 });

const keyResponse = await fetch(`${OPENROUTER_BASE_URL}/key`, {
  headers: { Authorization: `Bearer ${config.apiKey}` },
});
const keyInfo = (await keyResponse.json()) as { data?: { free_model_daily_requests?: unknown } };
console.log("Free model requests today:", JSON.stringify(keyInfo.data?.free_model_daily_requests ?? "unknown"));

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
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "What is the weather in Lisbon? Use the tool." }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "get_weather" } },
      max_tokens: 2000,
    });
    const call = response.choices[0]?.message.tool_calls?.[0];
    const ok = call?.type === "function" && call.function.name === "get_weather";
    console.log(`${model}: ${ok ? "tool call ok" : "NO tool call"} in ${Date.now() - started} ms (served by ${response.model})`);
  } catch (error) {
    console.log(`${model}: FAILED after ${Date.now() - started} ms: ${(error as Error).message}`);
  }
}
