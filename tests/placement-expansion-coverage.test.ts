import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Regra de 30/09/2026: todo criativo pede a expansão sem corte. Este teste
 * protege contra o caminho NOVO que monte um POST /adcreatives sem passar pela
 * regra central (`creative-features.ts`) — foi exatamente assim que os wizards
 * ficaram de fora até o caso Atemporal.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED = ["lib", "app"];
/** Monta, numa string, um caminho que termina em /adcreatives. */
const CREATES_CREATIVE = /[`"'][^`"'\n]*\/adcreatives[`"']/;
const CENTRAL_RULE = /withPlacementExpansion\(|postAdCreativeForm\(|buildDegreesOfFreedomSpec\(/;
/** Citam o endpoint sem criar criativo. */
const NOT_CREATORS = new Map([
  ["lib/observability/meta-logger.ts", "só classifica o path nos logs"],
]);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}

describe("cobertura da expansão de formato", () => {
  it("todo arquivo que cria criativo passa pela regra central", () => {
    const offenders: string[] = [];
    for (const top of SCANNED) {
      for (const file of sourceFiles(join(ROOT, top))) {
        const rel = relative(ROOT, file).replaceAll("\\", "/");
        if (NOT_CREATORS.has(rel)) continue;
        const source = readFileSync(file, "utf8");
        if (CREATES_CREATIVE.test(source) && !CENTRAL_RULE.test(source)) offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "crie o criativo via postAdCreativeForm, withPlacementExpansion ou createCreative",
    );
  });
});
