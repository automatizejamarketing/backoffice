import { it } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

it("GET /api/users/search answers only id, email and name — never the password hash or billing fields", () => {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("./helpers/users-search-route-case.ts", import.meta.url))],
    { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe" },
  );
});
