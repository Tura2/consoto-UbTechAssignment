// Scenario evals against the real model and APIs, graded by code.
// Usage: npm run eval [-- --scenario demo] [--trials 3]. Each full run uses roughly 30-40 LLM requests.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { StreamEvent } from "../../../shared/events";
import { ROOT_DIR, loadConfig, loadDotEnv } from "../config";
import { SCENARIOS } from "../evals/scenarios";
import { newTrip } from "../orchestrator/trip";
import { runTurn } from "../orchestrator/turn";
import { createRuntime } from "../runtime";
import { createStore } from "../state/conversations";

loadDotEnv();
const { turnDeps } = createRuntime(loadConfig());
const { values } = parseArgs({ options: { scenario: { type: "string" }, trials: { type: "string", default: "1" } } });
const trials = Math.max(1, Number(values.trials) || 1);
const scenarios = SCENARIOS.filter((scenario) => !values.scenario || scenario.name === values.scenario);
if (scenarios.length === 0) {
  console.error(`Unknown scenario "${values.scenario}". Known: ${SCENARIOS.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

type Check = { scenario: string; trial: number; step: number; grader: string; pass: boolean; detail: string | null };
const checks: Check[] = [];
const transcripts: unknown[] = [];
let llmCalls = 0;

for (const scenario of scenarios) {
  for (let trial = 1; trial <= trials; trial++) {
    const conversation = createStore(newTrip).getOrCreate();
    for (const [index, step] of scenario.steps.entries()) {
      const events: StreamEvent[] = [];
      const turn = await runTurn(conversation, step.message, turnDeps, (event) => events.push(event), new AbortController().signal);
      llmCalls += events.filter((event) => event.type === "llm_call").length;
      transcripts.push({ scenario: scenario.name, trial, step: index + 1, message: step.message, answer: turn.answer, trip: conversation.trip, events });
      for (const grader of step.graders) {
        const detail = grader.check({ events, trip: conversation.trip, answer: turn.answer });
        checks.push({ scenario: scenario.name, trial, step: index + 1, grader: grader.name, pass: detail === null, detail });
      }
    }
  }
}

for (const check of checks) {
  console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.scenario} #${check.trial} step ${check.step}: ${check.grader}${check.detail ? ` (${check.detail})` : ""}`);
}
console.log("");
for (const scenario of scenarios) {
  const own = checks.filter((check) => check.scenario === scenario.name);
  const passed = own.filter((check) => check.pass).length;
  // pass^k: the scenario counts only if every check passed in every trial.
  const passAll = trials > 1 ? `, pass^${trials}: ${passed === own.length ? "yes" : "no"}` : "";
  console.log(`${scenario.name}: ${passed}/${own.length} checks passed${passAll}`);
}

const dir = path.join(ROOT_DIR, "evals", "runs");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify({ checks, transcripts }, null, 2));
console.log(`\n${llmCalls} LLM calls. Transcripts saved to ${path.relative(ROOT_DIR, file)}`);
process.exit(checks.every((check) => check.pass) ? 0 : 1);
