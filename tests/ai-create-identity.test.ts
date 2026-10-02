import { it } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("AI create forwards the authorized customer's BISU context to identity resolution", () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("./helpers/ai-create-identity-case.ts", import.meta.url))], { stdio: "pipe", timeout: 20000 });
});
