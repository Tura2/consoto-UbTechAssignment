import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("reads the key, splits the model list and applies defaults", () => {
    const config = loadConfig({ OPENROUTER_API_KEY: "key", OPENROUTER_MODELS: "a:free, b:free ,,openrouter/free" });
    expect(config.apiKey).toBe("key");
    expect(config.models).toEqual(["a:free", "b:free", "openrouter/free"]);
    expect(config.port).toBe(3000);
    expect(config.llmRequestsPerMinute).toBe(15);
  });

  it("uses the default model list when none is set", () => {
    const config = loadConfig({ OPENROUTER_API_KEY: "key" });
    expect(config.models).toEqual(DEFAULT_MODELS.split(","));
  });

  it("fails with a readable message when the key is missing", () => {
    expect(() => loadConfig({})).toThrow(/OPENROUTER_API_KEY is missing/);
    expect(() => loadConfig({ OPENROUTER_API_KEY: "  " })).toThrow(/OPENROUTER_API_KEY is missing/);
  });

  it("rejects a port that is not a positive whole number", () => {
    expect(() => loadConfig({ OPENROUTER_API_KEY: "key", PORT: "abc" })).toThrow(/PORT must be a positive whole number/);
  });
});
