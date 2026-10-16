import { it } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
it("POST adset denies a target account outside the client's grants before discovery or writes",()=>{
 execFileSync(process.execPath,[fileURLToPath(new URL("./helpers/adset-account-denial-case.ts",import.meta.url))],{cwd:fileURLToPath(new URL("..",import.meta.url)),stdio:"pipe"});
});
