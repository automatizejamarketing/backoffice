import { spawnSync } from "node:child_process";
import { loadAppEnv } from "../lib/env/load-env";

loadAppEnv();

const [, , ...commandArgs] = process.argv;

if (commandArgs.length === 0) {
  console.error("Usage: bun scripts/with-env.ts <command...>");
  process.exit(1);
}

const [command, ...args] = commandArgs;
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
