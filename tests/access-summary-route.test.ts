import { it } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("GET access-summary guards by marketing access and returns the read-only summary", () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./helpers/access-summary-route-case.ts", import.meta.url))],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe" },
  );
});
