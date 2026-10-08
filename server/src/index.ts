import path from "node:path";
import { createApp } from "./app";
import { CACHE_DIR, ROOT_DIR, loadConfig, loadDotEnv, type Config } from "./config";
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
  store: createStore(newTrip, { dir: path.join(CACHE_DIR, "conversations") }),
  turnDeps: createRuntime(config).turnDeps,
  health,
  webDist: path.join(ROOT_DIR, "web", "dist"),
});

app.listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`\n  Could not start on port ${config.port}: ${error.message}. Set PORT in .env to a free port.\n`);
    process.exit(1);
  }
  console.log(`\n  Consoto Offsite Assistant is running at http://localhost:${config.port}\n`);
  void health().then((info) => describeHealth(info).forEach((line) => console.log(`  ${line}`)));
});
