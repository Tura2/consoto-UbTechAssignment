import path from "node:path";
import { createApp } from "./app";
import { ROOT_DIR, loadConfig, loadDotEnv, type Config } from "./config";
import { createHealthCheck, describeHealth } from "./health";
import { newTrip } from "./orchestrator/trip";
import { createRuntime } from "./runtime";
import { createStore } from "./state/conversations";

loadDotEnv();
let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`\n  ${(error as Error).message}\n`);
  process.exit(1);
}

const health = createHealthCheck(config.apiKey, config.models);
const app = createApp({
  store: createStore(newTrip),
  turnDeps: createRuntime(config).turnDeps,
  health,
  webDist: path.join(ROOT_DIR, "web", "dist"),
});

app.listen(config.port, () => {
  console.log(`\n  Consoto Offsite Assistant is running at http://localhost:${config.port}\n`);
  void health().then((info) => describeHealth(info).forEach((line) => console.log(`  ${line}`)));
});
