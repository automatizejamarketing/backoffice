import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { REFERRAL_ADMIN_ACTION_VALUES } from "../lib/db/schema";

// As ações de auditoria do programa de afiliados são uma lista só de
// TypeScript (a coluna é `varchar` sem CHECK). Os dois apps escrevem e leem a
// mesma tabela, então a lista tem de ser a mesma nos dois `schema.ts` — uma
// ação que só um lado conhece vira erro de tipo no outro.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function siblingFrontendSchema(backofficeRoot: string): string | null {
  const dirName = basename(backofficeRoot);
  const suffix = dirName.startsWith("backoffice")
    ? dirName.slice("backoffice".length)
    : "";
  const candidates = [
    ...(process.env.FRONTEND_ROOT
      ? [join(process.env.FRONTEND_ROOT, "lib", "db", "schema.ts")]
      : []),
    join(backofficeRoot, "..", `automatize-frontend${suffix}`, "lib", "db", "schema.ts"),
    join(backofficeRoot, "..", "automatize-frontend", "lib", "db", "schema.ts"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function adminActionsDeclaredIn(source: string): string[] {
  const match = source.match(
    /export const REFERRAL_ADMIN_ACTION_VALUES = \[([\s\S]*?)\] as const;/,
  );
  if (!match) {
    throw new Error("REFERRAL_ADMIN_ACTION_VALUES não encontrado no schema do frontend");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

const frontendSchema = siblingFrontendSchema(root);

test(
  "as ações de auditoria do programa de afiliados são as mesmas nos dois schemas",
  { skip: frontendSchema ? false : "schema do frontend não encontrado (defina FRONTEND_ROOT)" },
  () => {
    assert.deepEqual(
      [...REFERRAL_ADMIN_ACTION_VALUES],
      adminActionsDeclaredIn(readFileSync(frontendSchema as string, "utf8")),
    );
  },
);
