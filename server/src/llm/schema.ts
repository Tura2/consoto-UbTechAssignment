import { z } from "zod";
import type { ChatTool } from "./openrouter";

// A tool definition for the model, generated from the same zod schema that validates the input.
export function toChatTool(name: string, description: string, input: z.ZodType): ChatTool {
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(input, { io: "input" }) as Record<string, unknown>;
  return { type: "function", function: { name, description, parameters } };
}
